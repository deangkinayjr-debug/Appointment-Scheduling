const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
let isSupabaseConnected = false;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

let fallbackAppointments = [
    { id: 1, name: "Juan Dela Cruz", service: "Transcript of Records (TOR)", window: "Window 3", status: "Waiting", email: "sample@email.com", targetDate: "2026-09-19", targetTime: "9:00 AM - 10:00 AM" }
];

let availableSlots = [];
let timeSlotLimits = {}; // Dito sine-save ng staff ang limit bawat oras

const registeredStudents = [
    { studentNumber: "CA202306112", name: "Jan Cristan R. Deangkinay", email: "jan@icct.edu.ph", password: "password123" },
    { studentNumber: "CA202300000", name: "Juan Dela Cruz", email: "juan@icct.edu.ph", password: "password123" }
];

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

app.post('/api/login', (req, res) => {
    const { fullName, studentNumber, password } = req.body;
    let student = registeredStudents.find(s => s.studentNumber === studentNumber);

    if (!student) {
        student = {
            studentNumber: studentNumber || "CA202300999",
            name: fullName || "Valued Student",
            email: `${studentNumber || 'student'}@icct.edu.ph`,
            password: password || "password123"
        };
        registeredStudents.push(student);
    }

    res.json({
        success: true,
        message: "Login successful!",
        user: {
            name: fullName || student.name,
            studentNumber: student.studentNumber,
            email: student.email
        }
    });
});

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
                return res.status(400).json({ error: "Paumanhin, ang oras na ito ay Full na at hindi na maaaring ma-book." });
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

    if (isSupabaseConnected && supabase) {
        try {
            const { data, error } = await supabase.from('appointments').insert([newAppointment]).select();
            if (error) throw error;
            return res.status(201).json(data[0]);
        } catch (err) {
            console.error("POST Error sa Supabase:", err.message);
        }
    }

    fallbackAppointments.push(newAppointment);
    res.status(201).json(newAppointment);
});

app.delete('/api/appointments/:id', async (req, res) => {
    const id = Number(req.params.id);

    if (isSupabaseConnected && supabase) {
        try {
            const { error } = await supabase.from('appointments').delete().eq('id', id);
            if (error) throw error;
            return res.json({ message: "Matagumpay na na-delete sa Supabase!" });
        } catch (err) {
            console.error("DELETE Error sa Supabase:", err.message);
        }
    }

    fallbackAppointments = fallbackAppointments.filter(item => item.id !== id);
    res.json({ message: "Matagumpay na na-delete ang appointment!" });
});

app.put('/api/appointments/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (isSupabaseConnected && supabase) {
        try {
            const { data, error } = await supabase.from('appointments').update({ status }).eq('id', id).select();
            if (error) throw error;
            return res.json({ message: "Matagumpay na na-update ang status!", data: data[0] });
        } catch (err) {
            console.error("UPDATE Error sa Supabase:", err.message);
        }
    }

    const item = fallbackAppointments.find(i => i.id === id);
    if (item) {
        item.status = status;
        return res.json({ message: "Matagumpay na na-update ang status!", data: item });
    }

    res.status(404).json({ error: "Hindi nahanap ang appointment" });
});

app.get('/api/slots', (req, res) => {
    res.json(availableSlots);
});

app.post('/api/slots', (req, res) => {
    const { date, limit } = req.body;
    if (!date) {
        return res.status(400).json({ error: "Kailangan ilagay ang petsa." });
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
        return res.status(400).json({ error: "Kailangan ang petsa at mga limit." });
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

    res.json({ message: "Tagumpay na nailagay ang slot limits para sa oras na ito!" });
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
        let maxLimit = limits[timeSlot] !== undefined ? limits[timeSlot] : 0; 
        let currentCount = appointments.filter(a => a.targetTime === timeSlot).length;
        slotStatus[timeSlot] = {
            limit: maxLimit,
            booked: currentCount,
            isFull: currentCount >= maxLimit
        };
    });

    res.json(slotStatus);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});