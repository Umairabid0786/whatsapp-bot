const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let latestQr = '';
let isAuthenticated = false;
let connectionStatus = 'Waiting for Login ❌';

// WhatsApp Client Configuration
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
            '--disable-blink-features=AutomationControlled'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
    }
});

// --- DETAILED LOGS FOR TRACKING ---

client.on('qr', (qr) => {
    latestQr = qr;
    isAuthenticated = false;
    connectionStatus = 'Waiting for Scan 📱';
    console.log('👉 [SERVER]: Naya QR Code mil gaya hai. Scan ke liye taiyar!');
});

client.on('loading_screen', (percent, message) => {
    connectionStatus = `Loading Chats: ${percent}% ⏳`;
    console.log(`⏳ [SERVER]: Chats Load ho rahi hain: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
    isAuthenticated = true;
    connectionStatus = 'Authenticated! Connecting... 🔄';
    console.log('👍 [SERVER]: Authentication Kamyab! Chats sync ho rahi hain.');
});

client.on('ready', () => {
    isAuthenticated = true;
    latestQr = '';
    connectionStatus = 'Connected ✅';
    console.log('✅ [SERVER]: WhatsApp Bot Successfully CONNECTED aur Live hai!');
});

client.on('auth_failure', (msg) => {
    isAuthenticated = false;
    connectionStatus = 'Auth Failed ❌';
    console.log('❌ [SERVER]: Authentication Fail! Wajah:', msg);
});

client.on('disconnected', (reason) => {
    isAuthenticated = false;
    connectionStatus = 'Disconnected ❌';
    console.log('ℹ️ [SERVER]: WhatsApp Disconnect ho gaya. Wajah:', reason);
});

// --- API ROUTES ---

// 1. QR Display Route
app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2 style="color:green; text-align:center; margin-top:50px; font-family:sans-serif;">WhatsApp Connected Hai!</h2>');
    }
    if (!latestQr) {
        return res.send('<h2 style="text-align:center; margin-top:50px; font-family:sans-serif;">QR Code generate ho raha hai... 10 seconds baad Refresh karein.</h2>');
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se scan karein</h2>
                <div style="margin:20px;">
                    <img src="${qrImage}" alt="QR" style="width:250px; height:250px; border:1px solid #ddd; padding:10px;" />
                </div>
                <p><b>Status:</b> ${connectionStatus}</p>
                <p style="color:#666; font-size:14px;">Agar "Couldn't link device" aaye, to mobile data use karein aur page refresh karke naya QR scan karein.</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR.');
    }
});

// 2. Message Send Route
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!isAuthenticated) return res.status(500).json({ status: 'error', message: 'WhatsApp Connected nahi hai.' });

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '92' + formattedPhone.substring(1);
        if (!formattedPhone.endsWith('@c.us')) formattedPhone = `${formattedPhone}@c.us`;

        await client.sendMessage(formattedPhone, message);
        res.json({ status: 'success', message: 'Message sent successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

// 3. Main Status Route
app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Status: ${connectionStatus}`);
});

app.listen(port, () => {
    console.log(`Server port ${port} par chal raha hai.`);
    client.initialize();
});
