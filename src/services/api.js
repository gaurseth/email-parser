const config = require('../config');

/**
 * Forward parsed booking data to the parent API.
 */
async function sendParsedBooking(booking) {
  if (!config.PARENT_API_URL) {
    console.log('PARENT_API_URL not configured, skipping API forwarding');
    return null;
  }

  const response = await fetch(config.PARENT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.PARENT_API_KEY && {
        Authorization: `Bearer ${config.PARENT_API_KEY}`,
      }),
    },
    body: JSON.stringify(booking),
  });

  if (!response.ok) {
    throw new Error(
      `Parent API responded with ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

module.exports = { sendParsedBooking };
