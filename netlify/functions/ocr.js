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
      : `This is a Golf GameBook screenshot. ONE player has their scorecard expanded (showing a full grid with Hul/Handicap/Par/Score/Point rows). ALL other players are just summary rows in the leaderboard above.

STEP 1: Find the expanded scorecard grid - it shows individual hole data in a table.
STEP 2: Read the PLAYER NAME shown just above or in that expanded scorecard section.
STEP 3: Read the Score row (actual strokes per hole) and Par row from the grid.
STEP 4: Find "Score X/Y" at the bottom of the expanded section - X = gross strokes, Y = stableford points.
STEP 5: DO NOT use any data from the leaderboard summary rows for the expanded player.

Extract ONLY the expanded player:
- name: player name from the expanded scorecard section
- stableford: Y from "Score X/Y" at bottom (stableford points total)
- grossScore: X from "Score X/Y" (total strokes)
- holeScores: array from Score row left to right (exclude the "Ud" total)
- holePars: array from Par row left to right (exclude the "Ud" total)
- holes: "For9" if holes 1-9, "Bag9" if 10-18, "18" if full
- course: course name from top
- date: from "Game MM/DD/YYYY" → "YYYY-MM-DD"
- birdies: 0 (will be calculated separately)

ONLY valid JSON, no other text:
{"course":"...","holes":"For9","date":"2026-04-21","players":[{"name":"Jacob Andersen","stableford":20,"grossScore":40,"birdies":0,"holeScores":[4,5,4,6,6,2,3,5,5],"holePars":[4,4,3,5,4,3,4,4,4]}]}`;

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
    
    // Extract JSON from anywhere in the response (model may add text before/after)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Ingen scorecard data fundet i svaret');
    const clean = jsonMatch[0];

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
