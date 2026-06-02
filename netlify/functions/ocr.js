// Google Gemini API - Free tier (1500 requests/day)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { images } = JSON.parse(event.body);
    if (!images || images.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No images provided' }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };
    }

    const results = [];

    for (const imageBase64 of images) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: imageBase64
                  }
                },
                {
                  text: `Extract golf scorecard data from this Golf GameBook screenshot. Return ONLY valid JSON with this exact format, no other text, no markdown:
{
  "players": [
    {
      "name": "Player Name",
      "stableford": 28,
      "grossScore": 82,
      "birdies": 1
    }
  ],
  "course": "Course Name",
  "holes": "18"
}

Rules:
- Extract ALL players visible on scorecard
- stableford = total stableford points (the number after "/" in "Score XX/XX")
- grossScore = total strokes
- birdies = number of birdies (0 if not visible)
- holes: use "18" for 18 holes, "For9" for front 9, "Bag9" for back 9
- Return ONLY the JSON, nothing else, no backticks`
                }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1000
            }
          })
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${err}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      try {
        const clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        results.push(JSON.parse(clean));
      } catch (e) {
        console.error('Failed to parse Gemini response:', text);
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
