export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, userAnswers, ...anthropicBody } = body;

    // Subscribe to Kit using v3 API
    if (email) {
      const kitApiKey = process.env.KIT_API_KEY;
      if (kitApiKey) {
        await fetch('https://api.convertkit.com/v3/forms/9458646/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: kitApiKey,
            email: email
          })
        });
      }
    }

    // Fix model string and call Anthropic
    const fixedBody = {
      ...anthropicBody,
      model: 'claude-sonnet-4-5'
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(fixedBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Send emails via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const rawText = data.content?.find(b => b.type === 'text')?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      let plan = null;
      if (jsonMatch) {
        try { plan = JSON.parse(jsonMatch[0]); } catch(e) {}
      }

      const baseStyle = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;`;
      const footer = `<p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Powered by <strong>Amplify Authentic</strong> · alreadyabook.com</p>`;

      const answersHtml = userAnswers ? `
        <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Their Answers</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${Object.entries(userAnswers).map(([k, v]) => `
            <tr>
              <td style="padding:6px 12px 6px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top;">${k}</td>
              <td style="padding:6px 0;color:#333;font-size:13px;">${v}</td>
            </tr>
          `).join('')}
        </table>
      ` : '';

      let planHtml = '<p>Book plan generated.</p>';
      if (plan) {
        const titlesHtml = (plan.titles || []).map((t, i) =>
          `<div style="background:#fdf6ea;border-left:3px solid #b8883a;padding:10px 14px;margin-bottom:8px;">
            <span style="color:#b8883a;font-weight:600;font-size:12px;">Option ${i + 1}</span><br>
            <span style="color:#1a1714;">${t}</span>
          </div>`
        ).join('');

        const chaptersHtml = (plan.chapters || []).map(ch =>
          `<tr>
            <td style="padding:8px 12px;color:#b8883a;font-weight:600;vertical-align:top;white-space:nowrap;">${String(ch.number).padStart(2, '0')}</td>
            <td style="padding:8px 12px;">
              <strong style="color:#1a1714;">${ch.title}</strong><br>
              <span style="color:#666;font-size:14px;">${ch.description}</span>
            </td>
          </tr>`
        ).join('');

        planHtml = `
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Title Options</h3>
          ${titlesHtml}
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-top:24px;margin-bottom:8px;">Core Premise</h3>
          <p style="font-style:italic;color:#333;">${plan.premise}</p>
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-top:24px;margin-bottom:8px;">Your Reader</h3>
          <p style="color:#333;">${plan.readerProfile}</p>
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-top:24px;margin-bottom:8px;">What Kind of Book</h3>
          <p style="color:#333;">${plan.bookTypeLabel}: ${plan.bookTypeExplanation}</p>
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-top:24px;margin-bottom:8px;">Chapter by Chapter</h3>
          <table style="width:100%;border-collapse:collapse;">${chaptersHtml}</table>
          <h3 style="color:#666;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin-top:24px;margin-bottom:8px;">What Makes It Different</h3>
          <p style="font-style:italic;color:#333;border-left:3px solid #b8883a;padding-left:14px;">${plan.uniqueAngle}</p>
        `;
      }

      // Notify Brady
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: 'Already a Book <noreply@planmybook.com>',
          to: 'brady@bradyross.com',
          subject: `New Already a Book submission${email ? ' from ' + email : ''}`,
          html: `<div style="${baseStyle}">${answersHtml}${planHtml}${footer}</div>`,
        }),
      });

      // Send plan to user
      if (email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'Already a Book <noreply@planmybook.com>',
            to: email,
            subject: 'Your book plan is here',
            html: `<div style="${baseStyle}">
              <p style="color:#333;margin-bottom:24px;">Here's the book plan you generated at <a href="https://alreadyabook.com" style="color:#b8883a;">alreadyabook.com</a>. Keep it somewhere safe. This is your starting point.</p>
              ${planHtml}
              <div style="background:#1a1714;border-radius:8px;padding:32px;margin-top:32px;text-align:center;">
                <p style="color:#f0ece4;font-size:18px;font-family:Georgia,serif;margin:0 0 12px;">Your book is waiting to be written.</p>
                <p style="color:#8a7d72;font-size:14px;margin:0 0 20px;">You have the plan. Now comes the part most people never get past: putting words on the page. Amplify Authentic works with authors who have the ideas but need a pro to bring them to life.</p>
                <a href="mailto:brady@bradyross.com?subject=Already a Book" style="background:#b8883a;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px;">Work with Us</a>
              </div>
              ${footer}
            </div>`,
          }),
        });
      }
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
