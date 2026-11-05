// A short email through Resend, when RESEND_API_KEY and MAIL_FROM are set. It never throws: a missing key or a failed send must not stop the thing that asked for it.
export async function sendMail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) });
    if (!r.ok) console.warn('mail not sent', r.status);
    return r.ok;
  } catch (e) { console.warn('mail not sent', e.message); return false; }
}
