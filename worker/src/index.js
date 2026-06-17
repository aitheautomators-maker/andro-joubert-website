/**
 * Cloudflare Worker for Andro Joubert contact form
 * Receives form submissions and forwards to Make.com webhook
 */

// Fallback only used if env secret is not set (shouldn't happen)
const MAKE_WEBHOOK_URL_FALLBACK = '';

// Allowed origin (the website)
const ALLOWED_ORIGIN = 'https://andro-joubert.pages.dev';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    // Verify origin
    const origin = request.headers.get('Origin') || '';
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(403, { error: 'Forbidden' });
    }

    try {
      const contentType = request.headers.get('Content-Type') || '';
      let data;

      if (contentType.includes('application/json')) {
        data = await request.json();
      } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        data = Object.fromEntries(formData);
      } else {
        // Try JSON as fallback
        data = await request.json();
      }

      // Honeypot check (spam protection)
      if (data.website && data.website.trim() !== '') {
        // Bot filled the honeypot — silently accept but don't process
        return jsonResponse(200, { success: true, message: 'Enquiry sent successfully' });
      }

      // Validate required fields
      const required = ['name', 'email', 'interest', 'message'];
      const missing = required.filter(f => !data[f] || data[f].trim() === '');
      if (missing.length > 0) {
        return jsonResponse(400, { error: `Missing required fields: ${missing.join(', ')}` });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        return jsonResponse(400, { error: 'Invalid email address' });
      }

      // Sanitize and build payload
      const payload = {
        name: sanitize(data.name),
        email: sanitize(data.email),
        phone: sanitize(data.phone || ''),
        interest: sanitize(data.interest),
        message: sanitize(data.message),
        submitted_at: new Date().toISOString(),
        source: 'andro-joubert website contact form',
      };

      // Forward to Make.com webhook
      const webhookUrl = env?.MAKE_WEBHOOK_URL || MAKE_WEBHOOK_URL_FALLBACK;

      if (!webhookUrl) {
        // Log for testing if webhook not configured yet
        console.log('Form submission (webhook not configured):', JSON.stringify(payload));
        return jsonResponse(200, { success: true, message: 'Enquiry sent successfully (webhook pending)' });
      }

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!webhookResponse.ok) {
        console.error('Webhook failed:', webhookResponse.status, await webhookResponse.text());
        return jsonResponse(502, { error: 'Failed to forward enquiry. Please try again.' });
      }

      return jsonResponse(200, { success: true, message: 'Enquiry sent successfully' });

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse(500, { error: 'Internal server error' });
    }
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
  });
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
