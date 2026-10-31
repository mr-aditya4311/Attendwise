const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const userSessions = new Map();

// PSIT ERP Scraper Function
async function fetchPsitAttendance(username, password) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    // 1. Login Request
    const loginParams = new URLSearchParams();
    loginParams.append('username', username);
    loginParams.append('password', password);

    await client.post('https://erp.psit.ac.in/Erp/Auth', loginParams.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxRedirects: 5
    });

    // 2. Fetch Attendance Page
    const attResponse = await client.get('https://erp.psit.ac.in/Student/MyAttendanceDetail', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const html = attResponse.data;
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    // 3. Exact Label Parsing
    const totalMatch = bodyText.match(/Total\s*Lecture\s*[:\s]*(\d+)/i);
    const absentMatch = bodyText.match(/Total\s*Absent\s*\+\s*OAA\s*[:\s]*(\d+)/i);
    const oaaMatch = bodyText.match(/O\.?A\.?\s*Attendance\s*[:\s]*(\d+)/i);
    const pfMatch = bodyText.match(/Total\s*PF\s*[:\s]*(\d+)/i);
    // Newline aur multi-space tolerant regex
    const percentWithoutPfMatch = bodyText.match(/Attendance\s*%\s*without\s*PF\s*:\s*[\r\n\s]*([0-9]+(?:\.[0-9]+)?)/i);
    const percentWithPfMatch = bodyText.match(/Attendance\s*%\s*with\s*PF\s*:\s*[\r\n\s]*([0-9]+(?:\.[0-9]+)?)/i);

    if (!totalMatch) {
        throw new Error('Attendance data parse nahi ho saka. Kripya login credentials check karein.');
    }

    const totalLectures = parseInt(totalMatch[1], 10);
    const totalAbsentWithOAA = absentMatch ? parseInt(absentMatch[1], 10) : 0;
    const oaa = oaaMatch ? parseInt(oaaMatch[1], 10) : 0;
    const pf = pfMatch ? parseInt(pfMatch[1], 10) : 0;

    const netAbsent = Math.max(0, totalAbsentWithOAA - oaa);
    const attended = totalLectures - netAbsent;

    let percentage = percentWithPfMatch 
        ? parseFloat(percentWithPfMatch[1]) 
        : (percentWithoutPfMatch ? parseFloat(percentWithoutPfMatch[1]) : parseFloat(((attended / totalLectures) * 100).toFixed(2)));

    return {
        totalLectures,
        totalAbsentWithOAA,
        oaa,
        pf,
        attended,
        percentage,
        percentWithoutPf: percentWithoutPfMatch ? percentWithoutPfMatch[1] : null,
        percentWithPf: percentWithPfMatch ? percentWithPfMatch[1] : null
    };
}

// Route: ERP Login and Fetch
app.post('/api/connect-erp', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Roll No aur Password dono required hain.' });
    }

    try {
        const attendanceData = await fetchPsitAttendance(username, password);
        const token = 'token_' + Buffer.from(username).toString('base64');
        
        userSessions.set(token, {
            username,
            data: attendanceData,
            lastSynced: new Date().toISOString()
        });

        res.json({
            success: true,
            token: token,
            data: attendanceData
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message || 'ERP sync fail ho gaya.'
        });
    }
});

// Route: Get Saved Session
app.get('/api/my-attendance', (req, res) => {
    const token = req.headers['authorization'];
    if (!token || !userSessions.has(token)) {
        return res.status(404).json({ success: false, message: 'Session nahi mila.' });
    }

    const sessionData = userSessions.get(token);
    res.json({
        success: true,
        data: sessionData.data,
        last_synced: sessionData.lastSynced
    });
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 AttendWise Backend running on http://localhost:${PORT}`);
});
