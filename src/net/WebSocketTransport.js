import { EventEmitter } from 'events';

/**
 * WebSocketTransport — Client-side WebSocket transport.
 *
 * Connects to the relay server for encrypted message exchange.
 * Handles automatic reconnection with exponential backoff.
 */
export class WebSocketTransport extends EventEmitter {
    /**
     * @param {object} [options={}]
     * @param {number} [options.reconnectBaseDelay=1000] - Base delay for reconnection (ms)
     * @param {number} [options.reconnectMaxDelay=30000] - Max reconnect delay (ms)
     * @param {number} [options.maxReconnectAttempts=10] - Max reconnect attempts
     */
    constructor(options = {}) {
        super();
        this._url = null;
        this._ws = null;
        this._connected = false;
        this._reconnectAttempts = 0;
        this._reconnectBaseDelay = options.reconnectBaseDelay || 1000;
        this._reconnectMaxDelay = options.reconnectMaxDelay || 30000;
        this._maxReconnectAttempts = options.maxReconnectAttempts || 10;
        this._reconnectTimer = null;
        this._intentionalClose = false;
        /** @type {Array<string>} */
        this._sendBuffer = [];
    }

    /**
     * Whether the transport is currently connected.
     * @returns {boolean}
     */
    get connected() {
        return this._connected;
    }

    /**
     * Connect to a WebSocket server.
     * @param {string} url - WebSocket URL (ws:// or wss://)
     * @returns {Promise<void>}
     */
    connect(url) {
        this._url = url;
        this._intentionalClose = false;

        return new Promise((resolve, reject) => {
            try {
                // Dynamic import for Node.js vs browser
                this._createSocket(url, resolve, reject);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Create the WebSocket connection.
     * @param {string} url
     * @param {Function} [resolve]
     * @param {Function} [reject]
     */
    async _createSocket(url, resolve, reject) {
        let WebSocketImpl;

        // Use the 'ws' library in Node.js
        if (typeof globalThis.WebSocket !== 'undefined') {
            WebSocketImpl = globalThis.WebSocket;
        } else {
            const ws = await import('ws');
            WebSocketImpl = ws.default || ws.WebSocket;
        }

        this._ws = new WebSocketImpl(url);

        this._ws.onopen = () => {
            this._connected = true;
            this._reconnectAttempts = 0;
            this.emit('connected');

            // Flush send buffer
            while (this._sendBuffer.length > 0) {
                this._ws.send(this._sendBuffer.shift());
            }

            if (resolve) resolve();
        };

        this._ws.onmessage = (event) => {
            try {
                const data = typeof event.data === 'string' ? event.data : event.data.toString();
                const message = JSON.parse(data);
                this.emit('message', message);
            } catch (err) {
                this.emit('error', new Error(`Failed to parse message: ${err.message}`));
            }
        };

        this._ws.onclose = () => {
            this._connected = false;
            this.emit('disconnected');

            if (!this._intentionalClose) {
                this._scheduleReconnect();
            }
        };

        this._ws.onerror = (err) => {
            this.emit('error', err);
            if (reject && !this._connected) {
                reject(err);
                resolve = null;
                reject = null;
            }
        };
    }

    /**
     * Send an encrypted envelope.
     * @param {object} envelope
     */
    send(envelope) {
        const message = JSON.stringify(envelope);
        if (this._connected && this._ws && this._ws.readyState === 1) {
            this._ws.send(message);
        } else {
            // Buffer messages during disconnection
            this._sendBuffer.push(message);
        }
    }

    /**
     * Disconnect from the server.
     */
    disconnect() {
        this._intentionalClose = true;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this._connected = false;
    }

    /**
     * Schedule a reconnection attempt with exponential backoff.
     */
    _scheduleReconnect() {
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }

        const delay = Math.min(
            this._reconnectBaseDelay * Math.pow(2, this._reconnectAttempts),
            this._reconnectMaxDelay,
        );

        this._reconnectAttempts++;
        this.emit('reconnecting', { attempt: this._reconnectAttempts, delay });

        this._reconnectTimer = setTimeout(() => {
            if (this._url && !this._intentionalClose) {
                this._createSocket(this._url);
            }
        }, delay);
    }
}
