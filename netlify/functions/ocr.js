// NVIDIA NIM - Free tier, 40 RPM, no daily limit
// Parallel processing + 11B model for speed

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { images } = JSON.parse(event.body);
    if (!images || images.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No images provided' }) };
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'NVIDIA_API_KEY not configured' }) };
    }

    const prompt = `This is a Golf GameBook app screenshot. Extract ONLY the player with the expanded scorecard grid visible (hole-by-hole rows). IGNORE players in the leaderboard list only.

Extract:
- name: player name from the expanded scorecard
- stableford: SECOND number in "Score XX/YY" → YY
- grossScore: FIRST number in "Score XX/YY" → XX
- birdies: count holes where score < par (gross birdies only)
- holeScores: array from the Score row e.g. [6,4,4,6,6,4,5,5,5]
- holePars: array from the Par row e.g. [4,4,3,5,4,3,4,4,4]
- holes: "For9" if holes 1-9, "Bag9" if 10-18, "18" if full round
- course: course name
- date: date from "Game MM/DD/YYYY" at top, convert to ISO format YYYY-MM-DD (e.g. "Game 4/21/2026" → "2026-04-21")

Return ONLY valid JSON, no markdown:
{"course":"...","holes":"For9","date":"2026-04-21","players":[{"name":"...","stableford":16,"grossScore":45,"birdies":0,"holeScores":[6,4,4,6,6,4,5,5,5],"holePars":[4,4,3,5,4,3,4,4,4]}]}`;

    // Process all images IN PARALLEL for speed
    const promises = images.map(async (imageBase64) => {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model: 'meta/llama-3.2-11b-vision-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
              { type: 'text', text: prompt }
            ]
          }],
          max_tokens: 500,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`NVIDIA API error: ${response.status} - ${err.substring(0, 150)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const clean = text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      return JSON.parse(clean);
    });

    const results = await Promise.all(promises);

    // Merge players from all images
    const playerMap = {};
    const mergedPlayers = [];
    results.forEach(result => {
      (result.players || []).forEach(player => {
        const key = player.name.toLowerCase();
        if (!playerMap[key]) {
          playerMap[key] = player;
          mergedPlayers.push(player);
        }
      });
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: mergedPlayers,
        course: results[0]?.course || '',
        holes: results[0]?.holes || 'For9',
        date: results[0]?.date || ''
      })
    };

  } catch (error) {
    console.error('OCR Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
