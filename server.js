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

// Corrupt session ko saaf karne ka function
function clearSession() {
    const sessionPath = path.join(__dirname, 'auth_info_baileys');
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('🧹 [SERVER]: Old session folder cleared successfully.');
        } catch (err) {
            console.error('❌ [SERVER]: Session clear karne mein error:', err.message);
        }
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false, // RAM bachane ke liye
        markOnlineOnConnect: false,
        browser: Browsers.macOS('Desktop') // 👈 Fixed: Standard aur trusted desktop browser identity
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQr = qr;
            isAuthenticated = false;
            connectionStatus = 'Waiting for Scan 📱';
            console.log('👉 [SERVER]: Naya QR Code generate hua hai.');
        }

        if (connection === 'close') {
            isAuthenticated = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`ℹ️ [SERVER]: Connection close hui. Reason Code: ${statusCode}`);

            // Agar session corrupt ho ya WhatsApp block kare to session clear karke fresh start karein
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 405) {
                connectionStatus = 'Session Resetting... 🔄';
                clearSession();
                await delay(5000); 
                connectToWhatsApp();
            } else if (shouldReconnect) {
                connectionStatus = 'Reconnecting... 🔄';
                await delay(5000); // 5 seconds ka safe gap taakay Render deploy loop na kare
                connectToWhatsApp();
            } else {
                connectionStatus = 'Disconnected ❌';
            }
        } else if (connection === 'open') {
            isAuthenticated = true;
            latestQr = '';
            connectionStatus = 'Connected ✅';
            console.log('✅ [SERVER]: WhatsApp Bot successfully CONNECTED aur active hai!');
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
        res.json({ status: 'success', message: 'Message sent successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Status: ${connectionStatus}`);
});

// Start Bot Engine
connectToWhatsApp();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
