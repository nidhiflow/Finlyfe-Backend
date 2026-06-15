import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  const payload = { email: 'demo@finly.app', password: 'demo123' };

  console.log("1. Logging in locally...");
  const loginRes = await fetch('http://localhost:3002/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const loginData = await loginRes.json();
  const token = loginData.token;
  if (!token) {
    console.error("Login failed:", loginData);
    return;
  }

  const imgPath = path.join(__dirname, '../Finlyfd-main/public/icon-192.png');
  const base64 = fs.readFileSync(imgPath, { encoding: 'base64' });
  const dummyBase64 = `data:image/png;base64,${base64}`;

  console.log("2. Sending receipt scan request with a real image file...");
  const scanRes = await fetch('http://localhost:3002/api/ai/scan-receipt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ image: dummyBase64 })
  });

  const scanData = await scanRes.json();
  console.log("\nScan Receipt Response Status:", scanRes.status);
  console.log("Scan Receipt Response Data:", JSON.stringify(scanData, null, 2));
}

test();
