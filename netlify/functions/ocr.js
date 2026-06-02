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
                text: `This is a screenshot from the Golf GameBook app showing a Stableford scorecard.

The layout shows:
- Player name and HCP (e.g. "Jacob Andersen HCP 14")
- A hole grid with rows: Handicap / Par / Score / Point
- Summary line: "Par XX  Score XX/XX  Position X"
- The Score row shows strokes per hole (red circles = birdies, dark blue = bogey or worse)
- The Point row shows stableford points per hole
- "Ud" column = total for the 9 holes

Extract for the EXPANDED player (the one with the full scorecard grid visible - not just the name/score summary rows):
- name: exact name as shown
- stableford: the SECOND number after "/" in "Score XX/YY" → YY (this is the stableford total)
- grossScore: the FIRST number before "/" in "Score XX/YY" → XX (this is total strokes)
- birdies: count holes where Score row shows a score LESS than par for that hole (e.g. score 3 on par 4 = birdie). NOT net birdies - only gross birdies where actual strokes < par.

Also extract from the leaderboard rows above (players without expanded scorecard):
- name: player name
- stableford: number in the SCORE column (e.g. 20)
- grossScore: 0 (not visible)
- birdies: 0

holes: "For9" if hole numbers 1-9, "Bag9" if 10-18, "18" if full round

Respond ONLY with valid JSON, no markdown, no backticks:
{"course":"...","holes":"For9","players":[{"name":"...","stableford":16,"grossScore":45,"birdies":0}]}`
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
