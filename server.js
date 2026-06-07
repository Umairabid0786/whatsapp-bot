const { default: makeWASocket, DisconnectReason, delay, Browsers, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// ===== YAHAN BADLEIN: apni marzi ka koi password. WordPress mein bhi BILKUL YEHI daalni hai =====
const SHARED_SECRET = 'MY_SECRET_KEY_123';

let sock = null;
let latestQr = '';
let connectionStatus = 'Waiting for Login ❌';
let isAuthenticated = false;
let reconnectTimeout = null;
let retryCount = 0;
const MAX_RETRIES = 6;

let mongoClient = null;
let credsCollection = null;

// Pending orders yaad rakhne ke liye (phone => order_id)
const pendingOrders = {};

// ---- MongoDB connect ----
async function connectMongo() {
    if (credsCollection) return credsCollection;
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db('whatsapp_bot');
    credsCollection = db.collection('auth_store');
    console.log('✅ [MONGO]: Connected to MongoDB.');
    return credsCollection;
}

// ---- MongoDB-based Auth State (file system ki jagah DB use karta hai) ----
async function useMongoAuthState() {
    const coll = await connectMongo();

    const writeData = async (id, data) => {
        await coll.updateOne(
            { _id: id },
            { $set: { value: JSON.stringify(data, BufferJSON.replacer) } },
            { upsert: true }
        );
    };
    const readData = async (id) => {
        const doc = await coll.findOne({ _id: id });
        if (!doc) return null;
        return JSON.parse(doc.value, BufferJSON.reviver);
    };
    const removeData = async (id) => {
        await coll.deleteOne({ _id: id });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds),
        clearAll: async () => { await coll.deleteMany({}); }
    };
}

let clearAllSession = async () => {};

async function connectToWhatsApp() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const { state, saveCreds, clearAll } = await useMongoAuthState();
    clearAllSession = clearAll;

    // Purane socket ke listeners hatayein (RAM leak block)
    if (sock) {
        try { sock.ev.removeAllListeners(); } catch (e) {}
    }

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    // ---- Customer ke reply (1 ya 2) ko sunna ----
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const phoneKey = sender.split('@')[0];
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

        const orderId = pendingOrders[phoneKey];
        if (!orderId) return;

        if (text === '1') {
            await sock.sendMessage(sender, { text: `Shukriya! Aapka order #${orderId} *confirm* ho gaya hai ✅` });
            delete pendingOrders[phoneKey];
        } else if (text === '2') {
            await sock.sendMessage(sender, { text: `Aapka order #${orderId} *cancel* kar diya gaya hai ❌` });
            delete pendingOrders[phoneKey];
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQr = qr;
            isAuthenticated = false;
            connectionStatus = 'Waiting for Scan 📱';
            console.log('👉 [SERVER]: New QR Code generated.');
        }

        if (connection === 'close') {
            isAuthenticated = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`ℹ️ [SERVER]: Connection close. Reason Code: ${statusCode}`);

            // 1. Real logout (401)
            if (statusCode === DisconnectReason.loggedOut) {
                connectionStatus = 'Logged Out! Clearing session... 🔄';
                await clearAllSession();
                retryCount = 0;
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            }
            // 2. Restart required (515) — foran reconnect, session valid hai
            else if (statusCode === DisconnectReason.restartRequired) {
                console.log('🔁 [SERVER]: Restart required, reconnecting immediately...');
                reconnectTimeout = setTimeout(connectToWhatsApp, 1000);
            }
            // 3. Conflict / 405 — old container ko marne ka time dein
            else if (statusCode === 405) {
                retryCount++;
                if (retryCount > MAX_RETRIES) {
                    connectionStatus = 'Too many conflicts. Stopped. ⛔';
                    console.log('⛔ [SERVER]: Max retries hit. Manual restart needed.');
                    return;
                }
                connectionStatus = `Conflict (405)! Retry ${retryCount}/${MAX_RETRIES} in 10s... 🔄`;
                reconnectTimeout = setTimeout(connectToWhatsApp, 10000);
            }
            // 4. Baqi network issues
            else {
                retryCount++;
                if (retryCount > MAX_RETRIES) {
                    connectionStatus = 'Connection failed repeatedly. Stopped. ⛔';
                    return;
                }
                connectionStatus = 'Reconnecting... 🔄';
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isAuthenticated = true;
            latestQr = '';
            retryCount = 0;
            connectionStatus = 'Connected ✅';
            console.log('✅ [SERVER]: WhatsApp Bot CONNECTED!');
        }
    });
}

// ================= API ROUTES =================

// ---- QR code page ----
app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2 style="color:green; text-align:center; margin-top:50px; font-family:sans-serif;">WhatsApp Connected Hai! 🎉</h2>');
    }
    if (!latestQr) {
        return res.send(`<h2 style="text-align:center; margin-top:50px; font-family:sans-serif;">${connectionStatus}</h2><p style="text-align:center;">Page refresh karke check karein...</p>`);
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se scan karein</h2>
                <img src="${qrImage}" alt="QR" style="width:250px; height:250px; border:1px solid #ddd; padding:10px;" />
                <p><b>Current Status:</b> ${connectionStatus}</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('QR code generation failed.');
    }
});

// ---- WooCommerce order receive karke WhatsApp message bhejna ----
app.post('/woo-order', async (req, res) => {
    const { order_id, phone, name, total, items, secret } = req.body;

    if (secret !== SHARED_SECRET) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized' });
    }
    if (!isAuthenticated) {
        return res.status(500).json({ status: 'error', message: 'WhatsApp not connected' });
    }

    try {
        let formattedPhone = String(phone).replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '92' + formattedPhone.substring(1);
        if (!formattedPhone.startsWith('92') && formattedPhone.length === 10) {
            formattedPhone = '92' + formattedPhone;
        }
        const jid = `${formattedPhone}@s.whatsapp.net`;

        pendingOrders[formattedPhone] = order_id;

        const msg =
`Assalam-o-Alaikum ${name}! 🛍️

Aapka order *#${order_id}* mil gaya hai:

${items}
*Total: Rs. ${total}*

Order confirm karne ke liye *1* likh kar bhejein ✅
Cancel karne ke liye *2* likh kar bhejein ❌`;

        await sock.sendMessage(jid, { text: msg });
        res.json({ status: 'success' });
    } catch (error) {
        console.error('❌ [WOO-ORDER]:', error.message);
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

// ---- Manual message bhejne ka route ----
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!isAuthenticated) return res.status(500).json({ status: 'error', message: 'WhatsApp Connected nahi hai.' });

    try {
        let formattedPhone = String(phone).replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '92' + formattedPhone.substring(1);
        const jid = `${formattedPhone}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: message });
        res.json({ status: 'success', message: 'Message sent successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

// ---- Home / status ----
app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Engine Status: ${connectionStatus}`);
});

// ---- Global crash protection ----
process.on('uncaughtException', (err) => {
    console.error('⚠️ [UNCAUGHT]:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('⚠️ [UNHANDLED]:', err);
});

connectToWhatsApp();

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
