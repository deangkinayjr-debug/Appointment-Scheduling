const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
let isSupabaseConnected = false;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

// Resend Transporter Wrapper para hindi na baguhin ang sendMail calls mo
const transporter = {
    sendMail: async (mailOptions) => {
      const { from, to, subject, html, attachments } = mailOptions;
  
      // Convert attachments para sa Resend API
      const formattedAttachments = attachments ? attachments.map(att => {
        let content = att.content;
        
        // Kung Base64 string na may prefix, kunin lang ang mismong data at gawing Buffer
        if (typeof content === 'string') {
          if (content.includes('base64,')) {
            content = content.split('base64,')[1];
          }
          content = Buffer.from(content, 'base64');
        }
  
        return {
          filename: att.filename,
          content: content
        };
      }) : [];
  
      try {
        console.log('🚀 PUMAPASOK SA RESEND SENDMAIL TO:', process.env.EMAIL_TO || to);
  
        const { data, error } = await resend.emails.send({
            from: 'ICCT Registrar <onboarding@resend.dev>',
            to: process.env.EMAIL_TO || to,
            subject: subject,
            html: html,
            attachments: formattedAttachments,
          });
      
          if (error) {
            console.error('❌ Resend API Error:', error);
            // Fallback para hindi mag-crash ang app sa StackBlitz network block
            console.log('⚠️ [SIMULATOR MODE]: Email blocked by StackBlitz network, treating as simulated success.');
            return { success: true, simulated: true, error };
          }
      
          console.log('✅ Resend Email Sent Successfully:', data);
          return { success: true, simulated: false, response: data };
        } catch (err) {
          console.error('❌ Exception in sendMail:', err);
          // Fallback kapag nag-network timeout o error sa StackBlitz
          console.log('⚠️ [SIMULATOR MODE]: Exception caught, bypassing email error to keep booking working.');
          return { success: true, simulated: true };
        }
      }
  };
let fallbackAppointments = [];

let availableSlots = [];
let timeSlotLimits = {}; // Dito sine-save ng staff ang limit bawat oras

const registeredStudents = [];

function getWindowForService(service) {
    const window1 = ['Certificate of Enrollment', 'Certification of Grades', 'Summary of Grades'];
    const window2 = ['Certificate of Good Moral Character', 'Honorable Dismissal'];
    
    if (window1.includes(service)) {
        return 'Window 1';
    } else if (window2.includes(service)) {
        return 'Window 2';
    } else {
        return 'Window 3';
    }
}

async function checkSupabaseConnection() {
    if (!supabase) {
        console.log("Supabase Error, using fallback: Missing credentials");
        return;
    }
    try {
        const { data, error } = await supabase.from('appointments').select('*').limit(1);
        if (error) throw error;
        isSupabaseConnected = true;
        console.log("Connected to Supabase successfully!");
    } catch (err) {
        console.log("Supabase Error, using fallback:", err.message);
        isSupabaseConnected = false;
    }
}

checkSupabaseConnection();

// ==================== REGISTER API ====================
app.post('/api/register', async (req, res) => {
    const { fullName, studentNumber, password } = req.body;

    if (!fullName || !studentNumber || !password) {
        return res.status(400).json({ success: false, error: "All fields are required." });
    }

    if (isSupabaseConnected && supabase) {
        try {
            const { data: existingStudent } = await supabase
                .from('students')
                .select('*')
                .eq('studentNumber', studentNumber)
                .single();

            if (existingStudent) {
                return res.status(400).json({ success: false, error: "Student Number is already registered!" });
            }

            const { error: insertError } = await supabase
                .from('students')
                .insert([{ fullName, studentNumber, password }]);

            if (insertError) throw insertError;

            return res.json({ success: true, message: "Registration successful!" });
        } catch (err) {
            console.error("Supabase Register Error:", err.message);
            return res.status(500).json({ success: false, error: "Registration failed on database." });
        }
    }

    const existing = registeredStudents.find(s => s.studentNumber === studentNumber);
    if (existing) {
        return res.status(400).json({ success: false, error: "Student Number is already registered!" });
    }

    registeredStudents.push({
        fullName,
        studentNumber,
        email: `${studentNumber}@icct.edu.ph`,
        password
    });

    res.json({ success: true, message: "Registration successful!" });
});

// ==================== SECURE LOGIN API ====================
app.post('/api/login', async (req, res) => {
    const { studentNumber, password } = req.body;

    if (!studentNumber || !password) {
        return res.status(400).json({ success: false, error: "Please enter Student Number and Password." });
    }

    if (isSupabaseConnected && supabase) {
        try {
            const { data: student, error } = await supabase
                .from('students')
                .select('*')
                .eq('studentNumber', studentNumber)
                .single();

            if (error || !student) {
                return res.status(404).json({ success: false, error: "Account not yet registered. Please register first." });
            }

            if (student.password !== password) {
                return res.status(401).json({ success: false, error: "Incorrect password. Please try again." });
            }

            return res.json({
                success: true,
                message: "Login successful!",
                user: {
                    name: student.fullName,
                    studentNumber: student.studentNumber,
                    email: student.email || `${student.studentNumber}@icct.edu.ph`
                }
            });
        } catch (err) {
            console.error("Supabase Login Error:", err.message);
            return res.status(500).json({ success: false, error: "Internal server error." });
        }
    }

    const student = registeredStudents.find(s => s.studentNumber === studentNumber);

    if (!student) {
        return res.status(404).json({ success: false, error: "Account not yet registered. Please register first." });
    }

    if (student.password !== password) {
        return res.status(401).json({ success: false, error: "Incorrect password. Please try again." });
    }

    res.json({
        success: true,
        message: "Login successful!",
        user: {
            name: student.fullName,
            studentNumber: student.studentNumber,
            email: student.email
        }
    });
});

// ==================== APPOINTMENTS APIs ====================
app.get('/api/appointments', async (req, res) => {
    if (isSupabaseConnected && supabase) {
        try {
            const { data, error } = await supabase.from('appointments').select('*');
            if (error) throw error;
            return res.json(data);
        } catch (err) {
            console.error("GET Error from Supabase:", err.message);
        }
    }
    res.json(fallbackAppointments);
});

app.post('/api/appointments', async (req, res) => {
    console.log("QR sent successfully:", req.body.email);
    console.log("Email User sa .env:", process.env.EMAIL_USER);

    const { name, email, service, targetDate, targetTime } = req.body;
    const assignedWindow = getWindowForService(service);

    if (targetDate && targetTime) {
        let formattedDate1 = targetDate;
        let formattedDate2 = ""; 
        
        if (targetDate.includes('-')) {
            let parts = targetDate.split('-');
            if (parts.length === 3) {
                formattedDate2 = `${parts[1]}/${parts[2]}/${parts[0]}`;
            }
        } else if (targetDate.includes('/')) {
            let parts = targetDate.split('/');
            if (parts.length === 3) {
                formattedDate1 = `${parts[2]}-${parts[0]}-${parts[1]}`;
            }
        }

        let slotLimitsForDate = timeSlotLimits[formattedDate1] || timeSlotLimits[formattedDate2] || {};
        let maxLimit = slotLimitsForDate[targetTime];

        if (maxLimit === undefined) {
            const generalSlot = availableSlots.find(s => s.date === formattedDate1 || s.date === formattedDate2);
            if (generalSlot) {
                maxLimit = generalSlot.limit;
            } else {
                maxLimit = 0; 
            }
        }

        if (maxLimit !== undefined) {
            let currentBookingsCount = 0;

            if (isSupabaseConnected && supabase) {
                try {
                    const { data, error } = await supabase
                        .from('appointments')
                        .select('*')
                        .or(`targetDate.eq.${formattedDate1},targetDate.eq.${formattedDate2}`)
                        .eq('targetTime', targetTime);
                    if (!error && data) {
                        currentBookingsCount = data.length;
                    }
                } catch (err) {
                    console.error("Error checking limits from Supabase:", err.message);
                }
            } else {
                currentBookingsCount = fallbackAppointments.filter(
                    item => (item.targetDate === formattedDate1 || item.targetDate === formattedDate2) && item.targetTime === targetTime
                ).length;
            }

            if (currentBookingsCount >= maxLimit) {
                return res.status(400).json({ error: "This time slot is already fully booked and can no longer accept appointments." });
            }
        }
    }

    const newAppointment = {
        id: Date.now(),
        name,
        email: email || "N/A",
        service,
        targetDate: targetDate || "Not specified",
        targetTime: targetTime || "Not specified",
        window: assignedWindow,
        status: "Waiting"
    };

    let savedAppointment = newAppointment;

    if (isSupabaseConnected && supabase) {
        try {
            const { data, error } = await supabase.from('appointments').insert([newAppointment]).select();
            if (error) throw error;
            savedAppointment = data[0];
        } catch (err) {
            console.error("POST Error sa Supabase:", err.message);
        }
    } else {
        fallbackAppointments.push(newAppointment);
    }

    // MAGPADALA NG EMAIL SA GMAIL (KASAMA ANG QR CODE)
    if (email && email !== "N/A") {
        const qrData = encodeURIComponent(`TICKET-ID:${savedAppointment.id}|Name:${name}|Service:${service}|Date:${targetDate}|Time:${targetTime}`);
        const qrCodeUrl = `https://quickchart.io/qr?text=${qrData}&size=200`;

        const mailOptions = {
            from: `"ICCT Registrar" <onboarding@resend.dev>`,
            to: email,
            subject: 'Appointment Reservation E-Ticket & QR Code',
            html: `
            <div style="background-color: #0b132b; padding: 25px 10px; font-family: 'Segoe UI', Arial, sans-serif;">
            <div style="max-width: 420px; margin: 0 auto; background-color: #0f172a; border: 2px solid #38bdf8; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 20px; text-align: center; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">E-Ticket </h2>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #93c5fd;">ICCT Registrar Official Queue</p>
                </div>

                <!-- Body Details -->
                <div style="padding: 24px; color: #f8fafc;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <span style="background-color: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 5px 14px; border-radius: 50px; font-size: 11px; font-weight: bold;">
                            ✓ CONFIRMED
                        </span>
                    </div>

                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Name:</td>
                            <td style="padding: 8px 0; color: #ffffff; font-weight: bold; text-align: right;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Service:</td>
                            <td style="padding: 8px 0; color: #ffffff; font-weight: bold; text-align: right;">${service}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Date:</td>
                            <td style="padding: 8px 0; color: #38bdf8; font-weight: bold; text-align: right;">${targetDate}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Time Slot:</td>
                            <td style="padding: 8px 0; color: #38bdf8; font-weight: bold; text-align: right;">${targetTime}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Window:</td>
                            <td style="padding: 8px 0; color: #ffffff; font-weight: bold; text-align: right;">${assignedWindow}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #94a3b8;">Ticket ID:</td>
                            <td style="padding: 8px 0; color: #c084fc; font-weight: bold; font-family: monospace; text-align: right;">#${savedAppointment.id}</td>
                        </tr>
                    </table>
                </div>

                <!-- Dotted Divider -->
                <div style="border-top: 2px dashed rgba(255, 255, 255, 0.15); margin: 0 15px;"></div>

                <!-- QR Code Section -->
                <div style="padding: 24px; text-align: center; background-color: rgba(15, 23, 42, 0.5);">
                    <p style="margin: 0 0 12px 0; font-size: 12px; color: #94a3b8;">Your Official Entry QR Code:</p>
                    <div style="display: inline-block; background: #ffffff; padding: 12px; border-radius: 12px;">
                        <img src="${qrCodeUrl}" alt="e-Ticket QR Code" style="width: 160px; height: 160px; display: block;" />
                    </div>
                    <p style="margin: 12px 0 0 0; font-size: 11px; color: #64748b;">Please present this QR code at your designated Window on your appointment date.</p>
                </div>

            </div>
        </div>
            `
        };

        try {
            const emailResult = await transporter.sendMail(mailOptions);
            if (emailResult.simulated) {
                console.log("⚠️ Email simulation triggered (StackBlitz network block bypassed safely).");
            } else {
                console.log("✅ e-Ticket Email with QR sent successfully!");
            }
        } catch (mailErr) {
            console.error("Error sending email wrapper:", mailErr.message);
        }
    }

    res.status(201).json(savedAppointment);
});

app.delete('/api/appointments/:id', async (req, res) => {
    const id = Number(req.params.id);

    if (isSupabaseConnected && supabase) {
        try {
            const { error } = await supabase.from('appointments').delete().eq('id', id);
            if (error) throw error;
            return res.json({ message: "Appointment successfully deleted." });
        } catch (err) {
            console.error("DELETE Error sa Supabase:", err.message);
        }
    }

    fallbackAppointments = fallbackAppointments.filter(item => item.id !== id);
    res.json({ message: "Appointment successfully deleted." });
});

app.put('/api/appointments/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (isSupabaseConnected && supabase) {
        try {
            const { data, error } = await supabase.from('appointments').update({ status }).eq('id', id).select();
            if (error) throw error;
            return res.json({ message: "Appointment status updated successfully.", data: data[0] });
        } catch (err) {
            console.error("UPDATE Error sa Supabase:", err.message);
        }
    }

    const item = fallbackAppointments.find(i => i.id === id);
    if (item) {
        item.status = status;
        return res.json({ message: "Appointment status updated successfully.", data: item });
    }

    res.status(404).json({ error: "Appointment not found." });
});

app.get('/api/slots', (req, res) => {
    res.json(availableSlots);
});

app.post('/api/slots', (req, res) => {
    const { date, limit } = req.body;
    if (!date) {
        return res.status(400).json({ error: "Date is required." });
    }
    
    const existing = availableSlots.find(s => s.date === date);
    if (existing) {
        existing.limit = Number(limit);
    } else {
        availableSlots.push({ id: Date.now().toString(), date, limit: Number(limit) || 50 });
    }
    res.json({ message: "Slot successfully created!" });
});

app.post('/api/staff/set-time-limits', (req, res) => {
    const { date, limits } = req.body;
    if (!date || !limits) {
        return res.status(400).json({ error: "Date and slot limits are required." });
    }
    
    let cleanDate = date.trim();
    if (cleanDate.includes('/')) {
        let parts = cleanDate.split('/');
        if (parts.length === 3) {
            cleanDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        }
    }

    timeSlotLimits[cleanDate] = limits;

    const existingSlot = availableSlots.find(s => s.date === cleanDate);
    if (!existingSlot) {
        availableSlots.push({ id: Date.now().toString(), date: cleanDate, limit: 50 });
    }

    res.json({ message: "Time slot limits have been saved successfully." });
});

app.get('/api/time-limits/:date', (req, res) => {
    let date = req.params.date.trim();
    if (date.includes('/')) {
        let parts = date.split('/');
        if (parts.length === 3) {
            date = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        }
    }
    res.json(timeSlotLimits[date] || {});
});

app.get('/api/slot-limits', (req, res) => {
    let normalizedLimits = {};
    for (let key in timeSlotLimits) {
        let cleanKey = key;
        if (key.includes('/')) {
            let parts = key.split('/');
            if (parts.length === 3) {
                cleanKey = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            }
        }
        normalizedLimits[cleanKey] = timeSlotLimits[key];
    }
    res.json(normalizedLimits);
});

// Student Calendar Available Dates
app.get('/api/available-dates', (req, res) => {
    const availableDates = availableSlots
        .filter(slot => Number(slot.limit) > 0)
        .map(slot => slot.date);
    res.json([...new Set(availableDates)]);
});

app.get('/api/slot-status/:date', async (req, res) => {
    let targetDate = req.params.date.trim();
    
    let normalizedDate = targetDate;
    if (targetDate.includes('/')) {
        let parts = targetDate.split('/');
        if (parts.length === 3) {
            normalizedDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        }
    }

    let limits = timeSlotLimits[normalizedDate] || {};
    const generalSlot = availableSlots.find(s => s.date === normalizedDate);
    
    const isDateConfigured = Object.keys(limits).length > 0 || generalSlot !== undefined;
    
    const defaultTimeSlots = [
        "9:00 AM - 10:00 AM",
        "10:00 AM - 11:00 AM",
        "11:00 AM - 12:00 NN",
        "1:00 PM - 2:00 PM",
        "2:00 PM - 3:00 PM",
        "3:00 PM - 4:00 PM",
        "4:00 PM - 5:00 PM",
        "5:00 PM - 6:00 PM"
    ];
    
    let appointments = [];
    if (isSupabaseConnected && supabase) {
        try {
            const { data } = await supabase
                .from('appointments')
                .select('*')
                .eq('targetDate', normalizedDate);
            appointments = data || [];
        } catch (err) {
            console.error("Error fetching slot status:", err.message);
        }
    } else {
        appointments = fallbackAppointments.filter(
            item => item.targetDate === normalizedDate
        );
    }

    let slotStatus = {};
    defaultTimeSlots.forEach(timeSlot => {
        let maxLimit = 0;
        
        if (isDateConfigured) {
            if (limits[timeSlot] !== undefined) {
                maxLimit = Number(limits[timeSlot]);
            } else if (generalSlot) {
                maxLimit = Number(generalSlot.limit);
            } else {
                maxLimit = 50;
            }
        } else {
            maxLimit = 0;
        }

        let currentCount = appointments.filter(a => a.targetTime === timeSlot).length;
        slotStatus[timeSlot] = {
            limit: maxLimit,
            booked: currentCount,
            isFull: maxLimit === 0 || currentCount >= maxLimit
        };
    });

    res.json(slotStatus);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});