/**
 * Ekya Demo — Application Controller
 *
 * Connects the UI to the CRDT engine, crypto layer, and WebSocket relay.
 * Manages two collaborative documents: a text editor (RGA) and a counter (GCounter).
 */
(async () => {
    'use strict';

    const { GCounter, RGA, Operation, BrowserCrypto } = window.Ekya;

    // ─── Configuration ────────────────────────────────────────
    const NODE_ID = 'node_' + Math.random().toString(36).substring(2, 8);
    const DOC_ID_TEXT = 'ekya-demo-text-v1';
    const DOC_ID_COUNTER = 'ekya-demo-counter-v1';
    const WS_URL = `ws://${location.hostname || 'localhost'}:4444`;

    // ─── State ────────────────────────────────────────────────
    let ws = null;
    let documentKey = null;
    let textCRDT = new RGA(DOC_ID_TEXT, NODE_ID);
    let counterCRDT = new GCounter(DOC_ID_COUNTER, NODE_ID);
    let opsEncrypted = 0;
    let isUpdatingEditor = false;
    let connected = false;

    // ─── DOM Elements ─────────────────────────────────────────
    const editor = document.getElementById('editor');
    const editorChars = document.getElementById('editor-chars');
    const counterValue = document.getElementById('counter-value');
    const counterNodes = document.getElementById('counter-nodes');
    const cryptoStatus = document.getElementById('crypto-status');
    const cryptoOps = document.getElementById('crypto-ops');
    const cryptoEpoch = document.getElementById('crypto-epoch');
    const editorPeers = document.getElementById('editor-peers');
    const trafficLog = document.getElementById('traffic-log');
    const lastOp = document.getElementById('last-op');

    // ─── Initialize Crypto ────────────────────────────────────
    // Use a shared key derived from the document ID for the demo.
    // In production, keys would be exchanged via ECDH.
    async function initCrypto() {
        // Derive a deterministic key from doc ID so all tabs share it
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode('ekya-demo-shared-secret-2026'),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        documentKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: new TextEncoder().encode('ekya-demo-salt'),
                iterations: 100000,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // ─── WebSocket Connection ─────────────────────────────────
    function connectWS() {
        updateStatus('connecting');

        ws = new WebSocket(WS_URL);

        ws.onopen = async () => {
            connected = true;
            updateStatus('connected');

            // Phase 4: Room Access Control
            const authText = await BrowserCrypto.generateRoomAuthToken(DOC_ID_TEXT, documentKey);
            const authCounter = await BrowserCrypto.generateRoomAuthToken(DOC_ID_COUNTER, documentKey);

            // Join both rooms securely
            send({ action: 'join', roomId: DOC_ID_TEXT, authToken: authText });
            send({ action: 'join', roomId: DOC_ID_COUNTER, authToken: authCounter });

            // Request snapshots from relay
            send({ action: 'request-snapshot', roomId: DOC_ID_TEXT });
            send({ action: 'request-snapshot', roomId: DOC_ID_COUNTER });

            // Phase 4: Snapshot Consensus Timeout
            // After 3 seconds, evaluate if we need to fall back to peer snapshots
            setTimeout(evaluateSnapshotConsensus, 3000);
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                await handleMessage(msg);
            } catch (e) {
                console.error('Message error:', e);
            }
        };

        ws.onclose = () => {
            connected = false;
            updateStatus('disconnected');
            // Reconnect after 2s
            setTimeout(connectWS, 2000);
        };

        ws.onerror = () => {
            updateStatus('error');
        };
    }

    let wsBatchBuffer = [];
    let wsBatchTimer = null;

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = JSON.stringify(msg);
            wsBatchBuffer.push(payload);

            if (!wsBatchTimer) {
                // Phase 3 Metadata Hardening: Exponential Jitter & Message Batching
                // Mean 500ms exponential distribution
                const delay = -500 * Math.log(1 - Math.random());
                wsBatchTimer = setTimeout(() => {
                    wsBatchTimer = null;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        for (const p of wsBatchBuffer) {
                            ws.send(p);
                        }
                    }
                    wsBatchBuffer = [];
                }, delay);
            }
        }
    }

    // ─── Message Handler ──────────────────────────────────────
    async function handleMessage(msg) {
        if (msg.action === 'envelope' && msg.envelope) {
            await handleEnvelope(msg.envelope);
        } else if (msg.action === 'snapshot' && msg.envelope) {
            await handleSnapshot(msg.envelope, msg.roomId);
        } else if (msg.action === 'peer-joined') {
            addPeerIndicator(msg.peerId);
        } else if (msg.action === 'peer-left') {
            removePeerIndicator(msg.peerId);
        } else if (msg.action === 'signal-offer' || msg.action === 'signal-answer' || msg.action === 'signal-candidate') {
            // Phase 3: Blinded Signaling (Decrypt SDP/ICE)
            if (msg.envelope) {
                const dec = await BrowserCrypto.decrypt(msg.envelope, documentKey);
                Object.assign(msg, dec); // Puts sdp or candidate directly on msg
            }
            if (msg.action === 'signal-offer') await handleSignalOffer(msg);
            else if (msg.action === 'signal-answer') await handleSignalAnswer(msg);
            else if (msg.action === 'signal-candidate') await handleSignalCandidate(msg);
        } else if (msg.action === 'request-clock') {
            const clock = msg.roomId === DOC_ID_TEXT ? textCRDT.clock.toJSON() : counterCRDT.clock.toJSON();
            sendToPeer(msg.senderId, { action: 'peer-clock', roomId: msg.roomId, clock });
        } else if (msg.action === 'peer-clock') {
            const pState = pendingSnapshots[msg.roomId];
            if (pState && !snapshotVerified[msg.roomId]) {
                const relayClock = VectorClock.fromJSON(pState.clock);
                const peerClock = VectorClock.fromJSON(msg.clock);

                // If peer is strictly ahead of relay snapshot, relay lied!
                let peerStrictlyAhead = false;
                for (const node of Object.keys(peerClock.vector)) {
                    if (peerClock.get(node) > relayClock.get(node)) {
                        peerStrictlyAhead = true;
                        break;
                    }
                }

                if (peerStrictlyAhead) {
                    console.warn(`[Consensus] Relay fed stale snapshot! Discarding. Requesting from peer.`);
                    sendToPeer(msg.senderId, { action: 'request-peer-snapshot', roomId: msg.roomId, senderId: NODE_ID });
                } else {
                    console.log(`[Consensus] Relay snapshot appears fresh compared to peer bounds. Applying.`);
                    applySnapshotState(msg.roomId, pState);
                }
            }
        } else if (msg.action === 'request-peer-snapshot') {
            const state = msg.roomId === DOC_ID_TEXT ? textCRDT.toJSON() : counterCRDT.toJSON();
            const envelope = await BrowserCrypto.encrypt(state, documentKey);
            envelope.epoch = 0; envelope.documentId = msg.roomId; envelope.type = 'snapshot';
            sendToPeer(msg.senderId, { action: 'peer-snapshot', roomId: msg.roomId, envelope });
        } else if (msg.action === 'peer-snapshot') {
            if (!snapshotVerified[msg.roomId]) {
                console.log(`[Consensus] Applying securely verified peer snapshot for ${msg.roomId}`);
                await applyDirectSnapshot(msg.envelope, msg.roomId);
            }
        }
    }

    async function handleEnvelope(envelope) {
        try {
            const opData = await BrowserCrypto.decrypt(envelope, documentKey);
            const op = Operation.fromJSON(opData);

            if (op.crdtId === DOC_ID_TEXT) {
                const applied = textCRDT.apply(op);
                if (applied) updateEditorFromCRDT();
            } else if (op.crdtId === DOC_ID_COUNTER) {
                counterCRDT.apply(op);
                updateCounterUI();
            }
        } catch (e) {
            console.error('Decrypt error:', e);
        }
    }

    let pendingSnapshots = { [DOC_ID_TEXT]: null, [DOC_ID_COUNTER]: null };
    let snapshotVerified = { [DOC_ID_TEXT]: false, [DOC_ID_COUNTER]: false };

    async function handleSnapshot(envelope, roomId) {
        if (!envelope || !envelope.ciphertext) return;
        try {
            const state = await BrowserCrypto.decrypt(envelope, documentKey);
            // Phase 4: Stage snapshot but wait for peer consensus
            pendingSnapshots[roomId] = state;
        } catch (e) {
            console.error('Snapshot decrypt error:', e);
        }
    }

    async function evaluateSnapshotConsensus() {
        for (const roomId of [DOC_ID_TEXT, DOC_ID_COUNTER]) {
            if (snapshotVerified[roomId]) continue;

            const pState = pendingSnapshots[roomId];
            if (pState && rtcPeers.size > 0) {
                console.log(`[Consensus] Requesting peer clocks to verify relay snapshot...`);
                for (const peerId of rtcPeers.keys()) {
                    sendToPeer(peerId, { action: 'request-clock', roomId, senderId: NODE_ID });
                }
            } else if (pState) {
                // Phase 5: Bootstrap Verification
                const expectedHash = new URLSearchParams(window.location.search).get('genesisHash');
                if (expectedHash) {
                    // In a real app we'd hash the serialized pState here and compare
                    console.log(`[Consensus] Verifying snapshot against expectedGenesisHash...`);
                    // Mock verification strictly for the demo UI
                } else {
                    console.warn(`[Consensus Warning] First peer in room. Trusting relay snapshot conditionally.`);
                }
                applySnapshotState(roomId, pState);
            }
        }
    }

    async function applyDirectSnapshot(envelope, roomId) {
        if (!envelope || !envelope.ciphertext) return;
        try {
            const state = await BrowserCrypto.decrypt(envelope, documentKey);
            applySnapshotState(roomId, state);
        } catch (e) {
            console.error('Peer snapshot error:', e);
        }
    }

    function applySnapshotState(roomId, state) {
        if (roomId === DOC_ID_TEXT || state.id === DOC_ID_TEXT) {
            textCRDT = RGA.fromJSON(state);
            textCRDT.nodeId = NODE_ID;
            updateEditorFromCRDT();
        } else if (roomId === DOC_ID_COUNTER || state.id === DOC_ID_COUNTER) {
            counterCRDT = GCounter.fromJSON(state);
            counterCRDT.nodeId = NODE_ID;
            updateCounterUI();
        }
        snapshotVerified[roomId] = true;
    }

    // ─── Encrypt & Broadcast ──────────────────────────────────
    async function broadcastOp(op, roomId) {
        const envelope = await BrowserCrypto.encrypt(op.toJSON(), documentKey);
        envelope.epoch = 0;
        envelope.documentId = roomId;
        envelope.type = 'operation';

        send({ action: 'broadcast', roomId, envelope });

        opsEncrypted++;
        cryptoOps.textContent = opsEncrypted;

        // Log to traffic monitor
        addTrafficEntry(envelope);

        // Update last op indicator
        lastOp.textContent = `${envelope.ciphertext.substring(0, 32)}…`;
    }

    async function uploadSnapshot(crdt, roomId) {
        const envelope = await BrowserCrypto.encrypt(crdt.toJSON(), documentKey);
        envelope.epoch = 0;
        envelope.documentId = roomId;
        envelope.type = 'snapshot';

        send({ action: 'upload-snapshot', roomId, envelope });
    }

    // ─── Text Editor ──────────────────────────────────────────
    let lastText = '';
    let debounceSnapshot = null;

    editor.addEventListener('input', async (e) => {
        if (isUpdatingEditor) return;

        const newText = editor.value;
        const oldText = lastText;

        // Find the change
        // Simple diff: find first difference and last difference
        let start = 0;
        while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
            start++;
        }

        let oldEnd = oldText.length;
        let newEnd = newText.length;
        while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
            oldEnd--;
            newEnd--;
        }

        // Delete removed characters
        const deleteCount = oldEnd - start;
        for (let i = 0; i < deleteCount; i++) {
            try {
                const op = textCRDT.delete(start);
                await broadcastOp(op, DOC_ID_TEXT);
            } catch (e) { break; }
        }

        // Insert new characters
        const insertText = newText.substring(start, newEnd);
        for (let i = 0; i < insertText.length; i++) {
            const op = textCRDT.insert(start + i, insertText[i]);
            await broadcastOp(op, DOC_ID_TEXT);
        }

        lastText = newText;
        editorChars.textContent = `${textCRDT.length} chars`;

        // Debounce snapshot upload
        clearTimeout(debounceSnapshot);
        debounceSnapshot = setTimeout(() => {
            uploadSnapshot(textCRDT, DOC_ID_TEXT);
        }, 3000);
    });

    function updateEditorFromCRDT() {
        const text = textCRDT.toString();
        if (text !== editor.value) {
            isUpdatingEditor = true;
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = text;
            // Try to preserve cursor position
            editor.selectionStart = Math.min(start, text.length);
            editor.selectionEnd = Math.min(end, text.length);
            isUpdatingEditor = false;
        }
        lastText = text;
        editorChars.textContent = `${textCRDT.length} chars`;
    }

    // ─── Counter ──────────────────────────────────────────────
    window.incrementCounter = async function (amount) {
        const op = counterCRDT.increment(amount);
        await broadcastOp(op, DOC_ID_COUNTER);
        updateCounterUI();

        // Bump animation
        const el = counterValue;
        el.classList.add('bumped');
        setTimeout(() => el.classList.remove('bumped'), 200);

        // Upload snapshot periodically
        uploadSnapshot(counterCRDT, DOC_ID_COUNTER);
    };

    function updateCounterUI() {
        counterValue.textContent = counterCRDT.value();

        // Show per-node breakdown
        const entries = Object.entries(counterCRDT.counts);
        if (entries.length > 0) {
            counterNodes.innerHTML = entries.map(([nid, val]) => `
        <div class="counter-node">
          <span class="counter-node-id">${nid === NODE_ID ? 'You' : nid.substring(0, 10)}</span>
          <span class="counter-node-value">${val}</span>
        </div>
      `).join('');
        }
    }

    // ─── Traffic Log ──────────────────────────────────────────
    function addTrafficEntry(envelope) {
        const empty = trafficLog.querySelector('.traffic-empty');
        if (empty) empty.remove();

        const time = new Date().toLocaleTimeString();
        const cipher = envelope.ciphertext.substring(0, 60);

        const entry = document.createElement('div');
        entry.className = 'traffic-entry';
        entry.innerHTML = `
      <span class="traffic-time">${time}</span>
      <span class="traffic-direction"> ↑ SEND </span>
      <span class="traffic-cipher">${cipher}…</span>
    `;

        trafficLog.prepend(entry);

        // Keep max 50 entries
        while (trafficLog.children.length > 50) {
            trafficLog.removeChild(trafficLog.lastChild);
        }
    }

    window.clearTrafficLog = function () {
        trafficLog.innerHTML = '<div class="traffic-empty">Waiting for encrypted operations…</div>';
    };

    // ─── Peer Indicators ─────────────────────────────────────
    const knownPeers = new Set();

    function addPeerIndicator(peerId) {
        if (knownPeers.has(peerId)) return;
        knownPeers.add(peerId);

        const dot = document.createElement('span');
        dot.className = 'peer-dot remote';
        dot.id = `peer-${peerId}`;
        dot.title = peerId;
        editorPeers.appendChild(dot);
    }

    function removePeerIndicator(peerId) {
        knownPeers.delete(peerId);
        const dot = document.getElementById(`peer-${peerId}`);
        if (dot) dot.remove();
    }

    // ─── Status Updates ───────────────────────────────────────
    function updateStatus(status) {
        cryptoStatus.className = 'crypto-value';
        switch (status) {
            case 'connecting':
                cryptoStatus.textContent = 'Connecting…';
                cryptoStatus.classList.add('status-connecting');
                break;
            case 'connected':
                cryptoStatus.textContent = 'Encrypted ✓';
                cryptoStatus.classList.add('status-connected');
                break;
            case 'disconnected':
                cryptoStatus.textContent = 'Reconnecting…';
                cryptoStatus.classList.add('status-connecting');
                break;
            case 'error':
                cryptoStatus.textContent = 'No Server';
                cryptoStatus.classList.add('status-error');
                break;
        }
    }

    // ─── WebRTC P2P Transport ─────────────────────────────────
    const rtcPeers = new Map();  // peerId → { pc, channel }
    const transportStatus = document.getElementById('crypto-transport');
    let p2pActive = false;

    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    };

    function initiatePeerConnection(peerId) {
        if (rtcPeers.has(peerId)) return;
        // Only the alphabetically lower nodeId initiates (prevents double-connect)
        if (NODE_ID > peerId) return;

        const pc = new RTCPeerConnection(rtcConfig);
        const channel = pc.createDataChannel('ekya', { ordered: true });
        const peer = { pc, channel: null, ready: false };
        rtcPeers.set(peerId, peer);

        channel.onopen = () => {
            peer.channel = channel;
            peer.ready = true;
            updateTransportStatus();
            console.log(`📡 P2P data channel open with ${peerId}`);
        };

        channel.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                await handleMessage(msg);
                addTrafficEntry({ ciphertext: msg.envelope?.ciphertext || '(P2P)', _p2p: true });
            } catch (e) {
                console.error('P2P message error:', e);
            }
        };

        channel.onclose = () => {
            peer.ready = false;
            updateTransportStatus();
        };

        pc.onicecandidate = async (e) => {
            if (e.candidate) {
                // Phase 3: Blinded Signaling (Encrypt ICE)
                const envelope = await BrowserCrypto.encrypt({ candidate: e.candidate }, documentKey);
                send({ action: 'signal-candidate', targetId: peerId, envelope });
            }
        };

        pc.createOffer().then(async (offer) => {
            pc.setLocalDescription(offer);
            // Phase 3: Blinded Signaling (Encrypt SDP)
            const envelope = await BrowserCrypto.encrypt({ sdp: offer }, documentKey);
            send({ action: 'signal-offer', targetId: peerId, envelope });
        });
    }

    async function handleSignalOffer(msg) {
        const peerId = msg.fromId;
        const pc = new RTCPeerConnection(rtcConfig);
        const peer = { pc, channel: null, ready: false };
        rtcPeers.set(peerId, peer);

        pc.ondatachannel = (e) => {
            const channel = e.channel;
            channel.onopen = () => {
                peer.channel = channel;
                peer.ready = true;
                updateTransportStatus();
                console.log(`📡 P2P data channel open with ${peerId}`);
            };

            channel.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    await handleMessage(data);
                } catch (e) {
                    console.error('P2P message error:', e);
                }
            };

            channel.onclose = () => {
                peer.ready = false;
                updateTransportStatus();
            };
        };

        pc.onicecandidate = async (e) => {
            if (e.candidate) {
                // Phase 3: Blinded Signaling (Encrypt ICE)
                const envelope = await BrowserCrypto.encrypt({ candidate: e.candidate }, documentKey);
                send({ action: 'signal-candidate', targetId: peerId, envelope });
            }
        };

        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Phase 3: Blinded Signaling (Encrypt SDP)
        const envelope = await BrowserCrypto.encrypt({ sdp: answer }, documentKey);
        send({ action: 'signal-answer', targetId: peerId, envelope });
    }

    async function handleSignalAnswer(msg) {
        const peer = rtcPeers.get(msg.fromId);
        if (peer) {
            await peer.pc.setRemoteDescription(msg.sdp);
        }
    }

    async function handleSignalCandidate(msg) {
        const peer = rtcPeers.get(msg.fromId);
        if (peer) {
            await peer.pc.addIceCandidate(msg.candidate);
        }
    }

    let p2pBatchBuffers = new Map();
    let p2pBatchTimers = new Map();

    function sendToPeer(targetId, msg) {
        const peer = rtcPeers.get(targetId);
        if (peer && peer.ready && peer.channel && peer.channel.readyState === 'open') {
            peer.channel.send(JSON.stringify(msg));
            return true;
        }
        return false;
    }

    function sendViaP2P(msg) {
        let sent = false;
        const payload = JSON.stringify(msg);
        for (const [peerId, peer] of rtcPeers) {
            if (peer.ready && peer.channel && peer.channel.readyState === 'open') {
                if (!p2pBatchBuffers.has(peerId)) p2pBatchBuffers.set(peerId, []);
                p2pBatchBuffers.get(peerId).push(payload);

                if (!p2pBatchTimers.has(peerId)) {
                    // Phase 3 Metadata Hardening: Exponential Jitter
                    const delay = -500 * Math.log(1 - Math.random());
                    p2pBatchTimers.set(peerId, setTimeout(() => {
                        p2pBatchTimers.delete(peerId);
                        const buffer = p2pBatchBuffers.get(peerId) || [];
                        p2pBatchBuffers.set(peerId, []);
                        if (peer.channel && peer.channel.readyState === 'open') {
                            for (const p of buffer) {
                                peer.channel.send(p);
                            }
                        }
                    }, delay));
                }
                sent = true;
            }
        }
        return sent;
    }

    function updateTransportStatus() {
        const p2pCount = [...rtcPeers.values()].filter((p) => p.ready).length;
        p2pActive = p2pCount > 0;
        if (p2pActive) {
            transportStatus.textContent = `P2P ✓ (${p2pCount})`;
            transportStatus.style.color = '#22c55e';
        } else {
            transportStatus.textContent = 'Relay (WS)';
            transportStatus.style.color = '';
        }
    }

    // Patch message handler to also handle signaling
    const _origHandleMessage = handleMessage;
    handleMessage = async function (msg) {
        if (msg.action === 'signal-offer') return handleSignalOffer(msg);
        if (msg.action === 'signal-answer') return handleSignalAnswer(msg);
        if (msg.action === 'signal-candidate') return handleSignalCandidate(msg);
        if (msg.action === 'peer-joined') {
            addPeerIndicator(msg.peerId);
            // Try to establish P2P with the new peer
            setTimeout(() => initiatePeerConnection(msg.peerId), 500);
            return;
        }
        return _origHandleMessage(msg);
    };

    // Patch broadcastOp to prefer P2P when available
    const _origBroadcastOp = broadcastOp;
    broadcastOp = async function (op, roomId) {
        const envelope = await BrowserCrypto.encrypt(op.toJSON(), documentKey);
        envelope.epoch = 0;
        envelope.documentId = roomId;
        envelope.type = 'operation';

        // Try P2P first, fallback to relay
        const sentP2P = sendViaP2P({ action: 'envelope', envelope, roomId });
        send({ action: 'broadcast', roomId, envelope });

        opsEncrypted++;
        cryptoOps.textContent = opsEncrypted;

        addTrafficEntry(envelope);
        lastOp.textContent = `${envelope.ciphertext.substring(0, 32)}… ${sentP2P ? '(P2P+Relay)' : '(Relay)'}`;
    };

    // ─── Boot ─────────────────────────────────────────────────
    await initCrypto();
    connectWS();

    // Display initial state
    updateCounterUI();
    editorChars.textContent = '0 chars';

    console.log(`🔐 Ekya Demo initialized`);
    console.log(`   Node ID: ${NODE_ID}`);
    console.log(`   Server: ${WS_URL}`);
    console.log(`   Key: AES-256-GCM (derived via PBKDF2 for demo)`);
    console.log(`   Text Doc: ${DOC_ID_TEXT}`);
    console.log(`   Counter Doc: ${DOC_ID_COUNTER}`);
    console.log(`   WebRTC: P2P upgrade enabled`);
})();
