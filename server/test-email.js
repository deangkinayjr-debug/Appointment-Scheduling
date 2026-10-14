require('dotenv').config({ path: './.env' });
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // false para sa port 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

async function testMail() {
    try {
        console.log("Sinusubukang kumonekta gamit ang:", process.env.EMAIL_USER);
        let info = await transporter.sendMail({
            from: `"Test Server" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Ipadala sa sarili mo
            subject: "Test Email from Node.js",
            text: "Kung natanggap mo ito, ibig sabihin gumagana ang Nodemailer!"
        });
        console.log("TAGUMPAY! Naipadala ang email:", info.response);
    } catch (err) {
        console.error("DETALYE NG ERROR SA NODEMAILER:", err);
    }
}

testMail();