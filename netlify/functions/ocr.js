// NVIDIA NIM - ONE image per call to avoid timeout

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const imageBase64 = body.image || (body.images && body.images[0]);
    if (!imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image provided' }) };
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'NVIDIA_API_KEY not configured' }) };
    }

    const isHandicap = body.type === 'handicap';
    const isSummary = body.type === 'summary';

    if (isSummary) {
      const summaryPrompt = `Du er en golf-kommentator for Tuesday Club hos Mølleåens Golfklub. Skriv en kort, personlig sæsonanalyse på dansk (3-5 sætninger) for spilleren baseret på nedenstående data. Inkluder deres placering på leaderboardet, form, og sammenlign lidt med de andre spillere. Vær positiv men ærlig. Brug golfterminologi. Skriv i tredje person.\n\n${body.context}`;
      
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta/llama-3.1-70b-instruct',
          messages: [{ role: 'user', content: summaryPrompt }],
          max_tokens: 300, temperature: 0.7
        })
      });
      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content || '';
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary }) };
    }

    const prompt = isHandicap
      ? `This is a GolfBox/DGU handicap list screenshot. Extract ALL rows showing player name and HCP value.
HCP values can be positive numbers (e.g. 11.6, 27.9) or plus-handicap (e.g. +1.5, +2.9).
Convert comma decimals to dots if needed.
Return ONLY valid JSON, no markdown:
{"players":[{"name":"Oscar Wanstrup","handicap":13.7},{"name":"Martin Juul","handicap":20.3}]}`
      : `This is a Golf GameBook app screenshot. Extract ONLY the player with the expanded scorecard grid visible (hole-by-hole rows). IGNORE players shown only in the leaderboard list.

Extract:
- name: exact player name from expanded scorecard
- stableford: SECOND number in "Score XX/YY" → YY
- grossScore: FIRST number in "Score XX/YY" → XX
- birdies: holes where score < par (gross only, not net)
- holeScores: Score row array e.g. [6,4,4,6,6,4,5,5,5]
- holePars: Par row array e.g. [4,4,3,5,4,3,4,4,4]
- holes: "For9" holes 1-9, "Bag9" holes 10-18, "18" full round
- course: course name
- date: from "Game MM/DD/YYYY" at top → ISO "YYYY-MM-DD" e.g. "Game 4/21/2026" → "2026-04-21"

ONLY valid JSON, no markdown, no backticks:
{"course":"...","holes":"For9","date":"2026-04-21","players":[{"name":"...","stableford":16,"grossScore":45,"birdies":0,"holeScores":[6,4,4,6,6,4,5,5,5],"holePars":[4,4,3,5,4,3,4,4,4]}]}`;

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
      throw new Error(`NVIDIA error: ${response.status} - ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: clean
    };

  } catch (error) {
    console.error('OCR Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
