const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let sock = null;
let latestQr = '';
let connectionStatus = 'Waiting for Login ❌';
let isAuthenticated = false;

async function connectToWhatsApp() {
    // Session automatically save karne ke liye
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false, // 👈 Purani history sync nahi karega taakay RAM crash na ho
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQr = qr;
            isAuthenticated = false;
            connectionStatus = 'Waiting for Scan 📱';
            console.log('👉 Naya QR Code generate hua hai.');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isAuthenticated = false;
            connectionStatus = 'Disconnected ❌';
            console.log('Connection close ho gayi. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp(); // Dubara connect karne ki koshish
            }
        } else if (connection === 'open') {
            isAuthenticated = true;
            latestQr = '';
            connectionStatus = 'Connected ✅';
            console.log('✅ WhatsApp Bot successfully CONNECTED!');
        }
    });
}

// --- API ROUTES ---

app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2 style="color:green; text-align:center; margin-top:50px; font-family:sans-serif;">WhatsApp Connected Hai!</h2>');
    }
    if (!latestQr) {
        return res.send('<h2 style="text-align:center; margin-top:50px; font-family:sans-serif;">QR Code generate ho raha hai... Page refresh karein.</h2>');
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se scan karein (Baileys Engine)</h2>
                <img src="${qrImage}" alt="QR" style="width:250px; height:250px; border:1px solid #ddd; padding:10px;" />
                <p><b>Status:</b> ${connectionStatus}</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR.');
    }
});

app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!isAuthenticated) return res.status(500).json({ status: 'error', message: 'WhatsApp Connected nahi hai.' });

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '92' + formattedPhone.substring(1);
        if (!formattedPhone.endsWith('@s.whatsapp.net')) formattedPhone = `${formattedPhone}@s.whatsapp.net`;

        await sock.sendMessage(formattedPhone, { text: message });
        res.json({ status: 'success', message: 'Message bhej diya gaya!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Status: ${connectionStatus}`);
});

// Start application
connectToWhatsApp();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
