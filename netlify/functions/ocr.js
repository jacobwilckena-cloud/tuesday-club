// NVIDIA NIM - Free tier, 40 RPM, no daily limit
// Model: meta/llama-3.2-90b-vision-instruct

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

    const results = [];

    for (const imageBase64 of images) {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model: 'meta/llama-3.2-90b-vision-instruct',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
              },
              {
                type: 'text',
                text: `You are reading a Golf GameBook screenshot. Extract golf scores and return ONLY a JSON object with no other text.

PRIORITY: If you see an expanded individual scorecard with "Score XX/YY" (e.g. "Score 45/16"), that player's data is:
- grossScore = XX (the first number, total strokes)
- stableford = YY (the second number, stableford points)
- birdies = count of holes where Point row shows 3 or more

For OTHER players only visible in the leaderboard:
- stableford = the number shown in the SCORE column (e.g. 20)
- grossScore = 0 (not visible)
- birdies = 0

The "TIL PAR" column shows +/- vs par — do NOT use this as stableford.

holes: use "18" for 18 holes, "For9" for front 9 (hul 1-9), "Bag9" for back 9 (hul 10-18). If you see hole numbers 1-9 only, it is "For9".

Return ONLY this JSON format:
{"players":[{"name":"Player Name","stableford":16,"grossScore":45,"birdies":1}],"course":"Course Name","holes":"For9"}`
              }
            ]
          }],
          max_tokens: 1000,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`NVIDIA API error: ${response.status} - ${err.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      try {
        const clean = text.trim()
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        results.push(JSON.parse(clean));
      } catch (e) {
        console.error('Parse error:', text);
        throw new Error('Kunne ikke læse scorecard - prøv et tydeligere billede');
      }
    }

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
        holes: results[0]?.holes || '18'
      })
    };

  } catch (error) {
    console.error('OCR Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
