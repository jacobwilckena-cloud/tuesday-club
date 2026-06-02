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
                text: `You are extracting golf scorecard data. Return ONLY a JSON object, no other text, no markdown, no backticks.

Format:
{"players":[{"name":"Player Name","stableford":28,"grossScore":82,"birdies":1}],"course":"Course Name","holes":"18"}

Rules:
- Extract ALL players from the scorecard
- stableford = stableford points (the SECOND number in "Score 45/16" → 16)
- grossScore = total strokes (the FIRST number in "Score 45/16" → 45)
- birdies = number of birdies (0 if not visible)
- holes: "18" for 18 holes, "For9" for front 9 (hul 1-9), "Bag9" for back 9 (hul 10-18)
- Return ONLY the JSON, nothing else`
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
