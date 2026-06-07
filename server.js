const SHARED_SECRET = 'MY_SECRET_KEY_123';
const pendingOrders = {};

app.post('/woo-order', async (req, res) => {
    const { order_id, phone, name, total, items, secret } = req.body;

    if (secret !== SHARED_SECRET) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized' });
    }
    if (!isAuthenticated) {
        return res.status(500).json({ status: 'error', message: 'WhatsApp not connected' });
    }

    try {
        let formattedPhone = phone.replace(/[^\d]/g, '');
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
            await sock.sendMessage(sender, { text: `Shukriya! Aapka order #${orderId} *confirm* ho gaya hai ✅` });
            delete pendingOrders[phoneKey];
        } else if (text === '2') {
            await sock.sendMessage(sender, { text: `Aapka order #${orderId} *cancel* kar diya gaya hai ❌` });
            delete pendingOrders[phoneKey];
        }
    });
app.listen(port, () => {
    console.log(`Server is perfectly listening on port ${port}`);
});
