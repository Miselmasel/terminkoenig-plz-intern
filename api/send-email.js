const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { emailSubject, senderBlock, mapImage, csvString, csvTable, holidaySection, plzCount } = req.body || {};

  if (!emailSubject || !senderBlock) {
    return res.status(400).json({ ok: false, error: 'Absender-Daten fehlen' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  // Extract base64 data from data URI for CID embedding
  const base64Data = mapImage ? mapImage.replace(/^data:image\/\w+;base64,/, '') : null;

  const emailHtml = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #333; margin: 0; padding: 20px; }
  h1 { color: #642d7b; border-bottom: 2px solid #642d7b; padding-bottom: 8px; margin-bottom: 16px; }
  h2 { color: #642d7b; margin-top: 28px; margin-bottom: 8px; }
  .info-box { background: #f5edfb; border: 1px solid #e4d4ec; border-radius: 6px; padding: 12px 16px; margin: 12px 0; }
  .info-box table { border-collapse: collapse; }
  .info-box td { padding: 3px 8px; }
  .info-box td:first-child { font-weight: bold; color: #642d7b; width: 150px; }
  img.map { max-width: 100%; border: 1px solid #ccc; border-radius: 4px; margin: 8px 0; }
  .overflow-x { overflow-x: auto; }
</style>
</head>
<body>
<h1>&#128081; Terminkönig – PLZ-Auswahl</h1>

<div class="info-box">
  <table>
    ${senderBlock.type === 'interessent'
      ? `<tr><td>Name:</td><td>${senderBlock.vorname} ${senderBlock.nachname}</td></tr>
         <tr><td>E-Mail:</td><td>${senderBlock.email}</td></tr>`
      : `<tr><td>Kundennummer:</td><td>${senderBlock.kundennummer}</td></tr>
         <tr><td>Vertragsnummer:</td><td>${senderBlock.vertragsnummer}</td></tr>`
    }
    <tr><td>Datum / Uhrzeit:</td><td>${now}</td></tr>
    <tr><td>Anzahl PLZ-Bereiche:</td><td>${plzCount}</td></tr>
  </table>
</div>

<h2>Kartenausschnitt</h2>
${base64Data
  ? '<img class="map" src="cid:mapimage@terminkoenig" alt="Kartenausschnitt">'
  : '<p style="color:#888;">Kein Screenshot verfügbar.</p>'}

<h2>PLZ-Übersicht</h2>
<div class="overflow-x">
${csvTable || '<p>Keine Daten.</p>'}
</div>

<h2>Regionale Feiertage ${new Date().getFullYear()}</h2>
${holidaySection || '<p>Keine Feiertags-Daten.</p>'}

<hr style="margin-top:32px;border:none;border-top:1px solid #e4d4ec;">
<p style="font-size:11px;color:#888;margin-top:8px;">
  Gesendet über die <a href="https://www.terminkoenig.de/" style="color:#642d7b;">Terminkönig PLZ-Karte</a>
</p>
</body>
</html>`;

  const mailOptions = {
    from: `"Terminkönig PLZ-Karte" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: process.env.EMAIL_TO,
    subject: `PLZ-Auswahl [${emailSubject}] (${plzCount} Bereiche) – ${now}`,
    html: emailHtml,
    attachments: [
      ...(base64Data ? [{
        filename: 'karte.jpg',
        content: Buffer.from(base64Data, 'base64'),
        cid: 'mapimage@terminkoenig'
      }] : []),
      ...(csvString ? [{
        filename: 'plz-auswahl.csv',
        content: Buffer.from(csvString, 'utf-8'),
        contentType: 'text/csv; charset=utf-8'
      }] : []),
      ...(base64Data ? [{
        filename: 'karte-screenshot.jpg',
        content: Buffer.from(base64Data, 'base64'),
        contentType: 'image/jpeg'
      }] : [])
    ]
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('SMTP error:', err.message);
    return res.status(500).json({ ok: false, error: 'E-Mail konnte nicht gesendet werden.' });
  }
};
