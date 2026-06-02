const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { images } = JSON.parse(event.body);
    
    if (!images || images.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No images provided' })
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    // Process each image with Claude
    const results = [];
    
    for (const imageBase64 of images) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250805',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: imageBase64
                  }
                },
                {
                  type: 'text',
                  text: `Extract golf scorecard data from this Golf GameBook screenshot. Return ONLY valid JSON with this exact format, no other text:
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
- Stableford points must be a number
- Gross score must be a number
- Birdies must be a number (0 if not visible)
- If data not found, use 0
- Return ONLY the JSON, nothing else`
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.content && data.content[0] && data.content[0].text) {
        try {
          var jsonStr = data.content[0].text.trim();
          // Strip markdown code fences if present
          jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(jsonStr);
          results.push(parsed);
        } catch (e) {
          console.error('Failed to parse Claude response:', data.content[0].text);
          throw new Error('Invalid response from Claude');
        }
      }
    }

    // Merge results from all images
    const mergedPlayers = [];
    const playerMap = {};
    
    results.forEach(result => {
      if (result.players) {
        result.players.forEach(player => {
          const key = player.name.toLowerCase();
          if (!playerMap[key]) {
            playerMap[key] = player;
            mergedPlayers.push(player);
          }
        });
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        players: mergedPlayers,
        course: results[0]?.course || '',
        holes: results[0]?.holes || '18'
      })
    };

  } catch (error) {
    console.error('OCR Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
