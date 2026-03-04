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

        ws.onopen = () => {
            connected = true;
            updateStatus('connected');

            // Join both rooms
            send({ action: 'join', roomId: DOC_ID_TEXT });
            send({ action: 'join', roomId: DOC_ID_COUNTER });

            // Request snapshots
            send({ action: 'request-snapshot', roomId: DOC_ID_TEXT });
            send({ action: 'request-snapshot', roomId: DOC_ID_COUNTER });
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

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
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

    async function handleSnapshot(envelope, roomId) {
        if (!envelope || !envelope.ciphertext) return;
        try {
            const state = await BrowserCrypto.decrypt(envelope, documentKey);
            if (roomId === DOC_ID_TEXT || state.id === DOC_ID_TEXT) {
                textCRDT = RGA.fromJSON(state);
                textCRDT.nodeId = NODE_ID; // Keep our nodeId
                updateEditorFromCRDT();
            } else if (roomId === DOC_ID_COUNTER || state.id === DOC_ID_COUNTER) {
                counterCRDT = GCounter.fromJSON(state);
                counterCRDT.nodeId = NODE_ID;
                updateCounterUI();
            }
        } catch (e) {
            console.error('Snapshot decrypt error:', e);
        }
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
})();
