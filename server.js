const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let latestQr = '';
let isAuthenticated = false;

// WhatsApp Client Configuration (ULTRA-LIGHTWEIGHT FOR RENDER FREE TIER)
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',            // 👈 RAM bachane ke liye GPU disabled
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-blink-features=AutomationControlled'
        ],
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', // 👈 Clean Mac User Agent
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
    },
    // Yeh block WhatsApp ko crash hone se bachayega
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2413.51-web_beta.html'
    }
});

// --- EVENTS WITH LOGS ---
client.on('qr', (qr) => {
    latestQr = qr;
    isAuthenticated = false;
    console.log('👉 SERVER LOG: Naya QR Code generate ho gaya.');
});

client.on('ready', () => {
    isAuthenticated = true;
    latestQr = '';
    console.log('✅ SERVER LOG: WhatsApp Bot Successfully CONNECTED!');
});

client.on('authenticated', () => {
    isAuthenticated = true;
    console.log('👍 SERVER LOG: Authentication Kamyab!');
});

client.on('auth_failure', (msg) => {
    isAuthenticated = false;
    console.log('❌ SERVER LOG: Auth Failure! Wajah:', msg);
});

// --- API ROUTES ---

app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2 style="color:green; text-align:center; margin-top:50px;">WhatsApp Connected Hai!</h2>');
    }
    if (!latestQr) {
        return res.send('<h2 style="text-align:center; margin-top:50px;">QR Code load ho raha hai... Page refresh karein.</h2>');
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se Scan Karein</h2>
                <img src="${qrImage}" alt="QR" style="width:250px; height:250px; border:1px solid #ddd; padding:10px;" />
                <p>Upar diye gaye QR ko scan karein. Agar link na ho, to mobile ka Wi-Fi off karke Mobile Data par check karein.</p>
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
        if (!formattedPhone.endsWith('@c.us')) formattedPhone = `${formattedPhone}@c.us`;

        await client.sendMessage(formattedPhone, message);
        res.json({ status: 'success', message: 'Message sent!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

app.get('/', (req, res) => {
    res.send(`WhatsApp Bot Status: ${isAuthenticated ? 'Connected ✅' : 'Waiting for Login ❌'}`);
});

app.listen(port, () => {
    console.log(`Server port ${port} par chal raha hai.`);
    client.initialize();
});
