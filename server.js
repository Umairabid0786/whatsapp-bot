const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let sock = null;
let latestQr = '';
let connectionStatus = 'Waiting for Login ❌';
let isAuthenticated = false;
let reconnectTimeout = null;

// Session clear karne ka function (Sirf tab chalega jab user khud logout karega)
function clearSession() {
    const sessionPath = path.join(__dirname, 'auth_info_baileys');
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('🧹 [SERVER]: Auth folder cleared safely.');
        } catch (err) {
            console.error('❌ [SERVER]: Folder clear karne mein error:', err.message);
        }
    }
}

async function connectToWhatsApp() {
    // Kisi bhi purane active timeout ko clear karein taakay double connection na banean
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Purane socket ke listeners remove karein taakay RAM leak na ho
    if (sock) {
        try { sock.ev.removeAllListeners(); } catch(e) {}
    }

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

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
            
            console.log(`ℹ️ [SERVER]: Connection close hui. Reason Code: ${statusCode}`);

            // 1. Agar sach mein Logout ho chuka ho (401)
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                connectionStatus = 'Logged Out! Generating New QR... 🔄';
                clearSession();
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            } 
            // 2. Agar Render ka double container ya conflict issue ho (405)
            else if (statusCode === 405) {
                connectionStatus = 'Conflict Detected! Retrying in 10s... 🔄';
                console.log('⚠️ [SERVER]: 405 Conflict! Wasting 10s for old container to shutdown...');
                reconnectTimeout = setTimeout(connectToWhatsApp, 10000); // 10 seconds ka safe gap
            } 
            // 3. Kisi aur normal network issue ki wajah se disconnect hua ho
            else {
                connectionStatus = 'Reconnecting... 🔄';
                reconnectTimeout = setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            isAuthenticated = true;
            latestQr = '';
            connectionStatus = 'Connected ✅';
            console.log('✅ [SERVER]: WhatsApp Bot completely CONNECTED!');
        }
    });
}

// --- API ROUTES ---
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

app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!isAuthenticated) return res.status(500).json({ status: 'error', message: 'WhatsApp Connected nahi hai.' });

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '92' + formattedPhone.substring(1);
        if (!formattedPhone.endsWith('@s.whatsapp.net')) formattedPhone = `${formattedPhone}@s.whatsapp.net`;

        await sock.sendMessage(formattedPhone, { text: message });
        res.json({ status: 'success', message: 'Message sent successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Engine Status: ${connectionStatus}`);
});

// Initial Setup Call
connectToWhatsApp();

app.listen(port, () => {
    console.log(`Server is perfectly listening on port ${port}`);
});
