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
let connectionStatus = 'Waiting for Login \u274c';
let isAuthenticated = false;
let reconnectTimeout = null;
let retryCount = 0;
const MAX_RETRIES = 20;
let hasLoggedInOnce = false;

let mongoClient = null;
let credsCollection = null;

const pendingOrders = {};

async function connectMongo() {
    if (credsCollection) return credsCollection;
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db('whatsapp_bot');
    credsCollection = db.collection('auth_store');
    console.log('\u2705 [MONGO]: Connected to MongoDB.');
    return credsCollection;
}

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
            await sock.sendMessage(sender, { text: `Shukriya! Aapka order #${orderId} *confirm* ho gaya hai \u2705` });
            delete pendingOrders[phoneKey];
        } else if (text === '2') {
            await sock.sendMessage(sender, { text: `Aapka order #${orderId} *cancel* kar diya gaya hai \u274c` });
            delete pendingOrders[phoneKey];
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQr = qr;
            isAuthenticated = false;
            retryCount = 0;
            connectionStatus = 'Waiting for Scan \ud83d\udcf1';
            console.log('\ud83d\udc49 [SERVER]: New QR Code generated. Scan karein!');
        }

        if (connection === 'close') {
            isAuthenticated = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`\u2139\ufe0f [SERVER]: Connection close. Reason Code: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut) {
                connectionStatus = 'Logged Out! Clearing session... \ud83d\udd04';
                await clearAllSession();
                retryCount = 0;
                hasLoggedInOnce = false;
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            }
            else if (statusCode === DisconnectReason.restartRequired) {
                console.log('\ud83d\udd01 [SERVER]: Restart required, reconnecting immediately...');
                reconnectTimeout = setTimeout(connectToWhatsApp, 1000);
            }
            else if (statusCode === 405) {
                retryCount++;
                if (hasLoggedInOnce && retryCount > MAX_RETRIES) {
                    connectionStatus = 'Too many conflicts. Stopped. \u26d4';
                    console.log('\u26d4 [SERVER]: Max retries hit. Manual restart needed.');
                    return;
                }
                connectionStatus = `Conflict (405). Retrying... \ud83d\udd04`;
                console.log(`\u26a0\ufe0f [SERVER]: 405 conflict, retry ${retryCount}. Waiting 8s...`);
                reconnectTimeout = setTimeout(connectToWhatsApp, 8000);
            }
            else {
                retryCount++;
                if (hasLoggedInOnce && retryCount > MAX_RETRIES) {
                    connectionStatus = 'Connection failed repeatedly. Stopped. \u26d4';
                    return;
                }
                connectionStatus = 'Reconnecting... \ud83d\udd04';
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isAuthenticated = true;
            hasLoggedInOnce = true;
            latestQr = '';
            retryCount = 0;
            connectionStatus = 'Connected \u2705';
            console.log('\u2705 [SERVER]: WhatsApp Bot CONNECTED!');
        }
    });
}

// ================= API ROUTES =================

app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2 style="color:green; text-align:center; margin-top:50px; font-family:sans-serif;">WhatsApp Connected Hai! \ud83c\udf89</h2>');
    }
    if (!latestQr) {
        return res.send(`<html><head><meta http-equiv="refresh" content="3"></head><body>
            <h2 style="text-align:center; margin-top:50px; font-family:sans-serif;">${connectionStatus}</h2>
            <p style="text-align:center; font-family:sans-serif;">QR ka intezar... (page khud refresh ho raha hai)</p>
        </body></html>`);
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`<html><head><meta http-equiv="refresh" content="20"></head><body>
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se scan karein</h2>
                <img src="${qrImage}" alt="QR" style="width:280px; height:280px; border:1px solid #ddd; padding:10px;" />
                <p><b>Current Status:</b> ${connectionStatus}</p>
                <p style="color:#888;">Scan na ho to 20s baad page khud naya QR dikhayega</p>
            </div>
        </body></html>`);
    } catch (err) {
        res.status(500).send('QR code generation failed.');
    }
});

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
`Assalam-o-Alaikum ${name}! \ud83d\udecd\ufe0f

Aapka order *#${order_id}* mil gaya hai:

${items}
*Total: Rs. ${total}*

Order confirm karne ke liye *1* likh kar bhejein \u2705
Cancel karne ke liye *2* likh kar bhejein \u274c`;

        await sock.sendMessage(jid, { text: msg });
        res.json({ status: 'success' });
    } catch (error) {
        console.error('\u274c [WOO-ORDER]:', error.message);
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

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

app.get('/reset', async (req, res) => {
    try {
        await clearAllSession();
        isAuthenticated = false;
        hasLoggedInOnce = false;
        retryCount = 0;
        latestQr = '';
        res.send('Session cleared! Ab service restart karein aur /qr scan karein.');
    } catch (e) {
        res.status(500).send('Reset failed: ' + e.message);
    }
});

app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Engine Status: ${connectionStatus}`);
});

process.on('uncaughtException', (err) => {
    console.error('\u26a0\ufe0f [UNCAUGHT]:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('\u26a0\ufe0f [UNHANDLED]:', err);
});

connectToWhatsApp();

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
