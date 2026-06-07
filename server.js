const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
let latestQr = '';
let isAuthenticated = false;

// WhatsApp Client Configuration
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/opt/render/.whatsapp-session' }), // Persistent storage location for Render
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
    }
});

client.on('qr', (qr) => {
    latestQr = qr;
    isAuthenticated = false;
    console.log('Naya QR Code aaya hai.');
});

client.on('ready', () => {
    isAuthenticated = true;
    latestQr = '';
    console.log('WhatsApp Bot Ready Hai!');
});

client.on('authenticated', () => {
    isAuthenticated = true;
});

// Browser mein QR dekhne ke liye URL
app.get('/qr', async (req, res) => {
    if (isAuthenticated) {
        return res.send('<h2>WhatsApp Connected Hai!</h2>');
    }
    if (!latestQr) {
        return res.send('<h2>QR code taiyar ho raha hai, page refresh karein...</h2>');
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Apne WhatsApp se Scan Karein</h2>
                <img src="${qrImage}" alt="QR" />
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR.');
    }
});

// Message Bhejne ki API
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;

    if (!isAuthenticated) {
        return res.status(500).json({ status: 'error', message: 'WhatsApp connect nahi hai.' });
    }

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
        if (!formattedPhone.endsWith('@c.us')) {
            formattedPhone = `${formattedPhone}@c.us`;
        }
        await client.sendMessage(formattedPhone, message);
        res.json({ status: 'success', message: 'Message sent!' });
    } catch (error) {
        res.status(500).json({ status: 'error', detail: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    client.initialize();
});
