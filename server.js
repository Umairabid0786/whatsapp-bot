const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let latestQr = '';
let isAuthenticated = false;

// WhatsApp Client Configuration (OPTIMIZED FOR RENDER 512MB RAM)
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
            '--disable-extensions',
            '--disable-blink-features=AutomationControlled',
            '--js-flags="--max-old-space-size=400"' // 👈 RAM ko 400MB tak limit rakhne ke liye
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
    },
    // Remote cache taakay resource load kam ho
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1017.0-web_beta.html'
    }
});

// QR Code Event
client.on('qr', (qr) => {
    latestQr = qr;
    isAuthenticated = false;
    console.log('Naya QR Code generate hua hai.');
});

// Ready Event
client.on('ready', () => {
    isAuthenticated = true;
    latestQr = '';
    console.log('WhatsApp Bot Bilkul Ready Aur Active Hai!');
});

// Authenticated Event
client.on('authenticated', () => {
    isAuthenticated = true;
});

// Auth Failure Event
client.on('auth_failure', () => {
    isAuthenticated = false;
});

// --- API ROUTES ---

app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2 style="color:green;">WhatsApp Pehle Se Connected Hai!</h2>
                <p>Aapka system messages bhejne ke liye taiyar hai.</p>
            </div>
        `);
    }
    if (!latestQr) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>QR Code taiyar ho raha hai...</h2>
                <p>Please 10-15 seconds ruk kar page ko <b>Refresh</b> karein.</p>
            </div>
        `);
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se yeh QR Code Scan Karein</h2>
                <div style="margin: 20px auto; padding: 10px; border: 1px solid #ccc; display:inline-block;">
                    <img src="${qrImage}" alt="WhatsApp QR Code" style="width:250px; height:250px;" />
                </div>
                <p>WhatsApp App kholein -> Linked Devices -> Link a Device par ja kar scan karein.</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('QR Code image generate karne mein error aya.');
    }
});

app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;

    if (!isAuthenticated) {
        return res.status(500).json({ status: 'error', message: 'WhatsApp server connected nahi hai.' });
    }

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '92' + formattedPhone.substring(1);
        }
        if (!formattedPhone.endsWith('@c.us')) {
            formattedPhone = `${formattedPhone}@c.us`;
        }

        await client.sendMessage(formattedPhone, message);
        res.json({ status: 'success', message: 'Message bhej diya gaya hai!' });
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
