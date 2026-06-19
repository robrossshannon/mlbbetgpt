exports.handler = async function () {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Fetch today's schedule with pitching matchups
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher(note),team,linescore,broadcasts`;
    const scheduleRes = await fetch(scheduleUrl);
    const scheduleData = await scheduleRes.json();

    const games = scheduleData.dates?.[0]?.games || [];

    if (!games.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ games: [], injuries: [] })
      };
    }

    // For each game, get pitcher stats
    const gameDetails = await Promise.all(games.map(async (game) => {
      const awayPitcher = game.teams?.away?.probablePitcher;
      const homePitcher = game.teams?.home?.probablePitcher;

      // Fetch season stats for each pitcher
      const [awayStats, homeStats] = await Promise.all([
        awayPitcher ? fetchPitcherStats(awayPitcher.id) : null,
        homePitcher ? fetchPitcherStats(homePitcher.id) : null
      ]);

      return {
        gameId: game.gamePk,
        gameTime: game.gameDate,
        status: game.status?.detailedState,
        away: {
          team: game.teams?.away?.team?.name,
          pitcher: awayPitcher ? {
            name: awayPitcher.fullName,
            id: awayPitcher.id,
            note: awayPitcher.note || null,
            stats: awayStats
          } : null
        },
        home: {
          team: game.teams?.home?.team?.name,
          pitcher: homePitcher ? {
            name: homePitcher.fullName,
            id: homePitcher.id,
            note: homePitcher.note || null,
            stats: homeStats
          } : null
        }
      };
    }));

    // Fetch injuries from MLB transactions (IL placements in last 30 days)
    const injuries = await fetchInjuries();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ games: gameDetails, injuries })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

async function fetchPitcherStats(pitcherId) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season,gameLog&group=pitching&season=${new Date().getFullYear()}&gameType=R`;
    const res = await fetch(url);
    const data = await res.json();

    // Season stats
    const seasonSplit = data.stats?.find(s => s.type?.displayName === 'season');
    const season = seasonSplit?.splits?.[0]?.stat || null;

    // Last 3 game log entries
    const gameLogSplit = data.stats?.find(s => s.type?.displayName === 'gameLog');
    const lastStarts = gameLogSplit?.splits?.slice(0, 3).map(g => ({
      date: g.date,
      opponent: g.opponent?.name,
      ip: g.stat?.inningsPitched,
      er: g.stat?.earnedRuns,
      h: g.stat?.hits,
      k: g.stat?.strikeOuts,
      bb: g.stat?.baseOnBalls,
      era: g.stat?.era
    })) || [];

    if (!season) return null;

    return {
      era: season.era,
      whip: season.whip,
      ip: season.inningsPitched,
      k9: season.strikeoutsPer9Inn,
      bb9: season.walksPer9Inn,
      kbb: season.strikeoutWalkRatio,
      fip: season.fielding, // placeholder; MLB API doesn't expose FIP directly
      wins: season.wins,
      losses: season.losses,
      lastStarts
    };
  } catch {
    return null;
  }
}

async function fetchInjuries() {
  try {
    const today = new Date();
    const past30 = new Date(today - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    const url = `https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate=${past30}&endDate=${todayStr}&typeCode=IL`;
    const res = await fetch(url);
    const data = await res.json();

    const injuries = (data.transactions || [])
      .filter(t => t.typeCode === 'IL' || t.typeDesc?.includes('Injured'))
      .slice(0, 40)
      .map(t => ({
        player: t.player?.fullName,
        team: t.fromTeam?.name || t.toTeam?.name,
        date: t.date,
        description: t.typeDesc,
        note: t.resolutionDate ? `Expected return: ${t.resolutionDate}` : null
      }));

    return injuries;
  } catch {
    return [];
  }
}
