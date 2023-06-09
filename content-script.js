function insertHtlmText(parentEl, elToCreate, data) {
  let element = document.getElementById(parentEl);
  let createdTag = document.createElement(elToCreate);
  createdTag.textContent = data;
  element.appendChild(createdTag);
}

function waitForMessage() {
  return new Promise(resolve => {
    chrome.runtime.onMessage.addListener(function listener(request) {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(request);
    });
  });
}

(async () => {
  const { userNickname, accuracy } = await waitForMessage();

  let currentAccuracy = (accuracy && parseInt(accuracy, 10)) || 3;

  chrome.runtime.sendMessage({ message: 'fetching' });

  const maps = ['de_inferno', 'de_nuke', 'de_mirage', 'de_overpass', 'de_ancient', 'de_vertigo', 'de_dust2'];

  const currentUrl = window.location.href;
  const regex = /room\/(.+)/;
  const currentMatch = currentUrl.match(regex)[1];

  const apiKey = '00234391-183a-42a1-951d-d6f60969a6da';

  const fetchFaceItApi = async url => {
    const res = await fetch(url, {
      method: 'get',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return res.json();
  };

  const matchDatas = await fetchFaceItApi(`https://open.faceit.com/data/v4/matches/${currentMatch}`);

  const teams = [];
  for (const faction in matchDatas.teams) {
    teams.push({
      name: matchDatas.teams[faction].name,
      playersId: matchDatas.teams[faction].roster.map(player => player.player_id),
    });
  }

  const getMapsWinrate = async playersId => {
    const teamMatches = await Promise.all(
      playersId.map(id =>
        fetchFaceItApi(`https://open.faceit.com/data/v4/players/${id}/history?game=csgo&offset=0&limit=100`)
      )
    );

    let allMatches = [];

    teamMatches.forEach(match => (allMatches = allMatches.concat(match.items)));
    const uniqueAllMatches = allMatches.filter(
      (match, index, self) => self.findIndex(m => m?.match_id === match?.match_id) === index
    );

    const praccMatches = uniqueAllMatches.filter(match => {
      const matchedPlayers = match.playing_players.filter(player => playersId.includes(player));
      return matchedPlayers.length >= currentAccuracy;
    });

    const mapList = {};

    await Promise.all(
      praccMatches.map(async match => {
        const matchData = await fetchFaceItApi(`https://open.faceit.com/data/v4/matches/${match.match_id}/stats`);
        if (!matchData.rounds) return;

        const map = matchData.rounds[0].round_stats.Map;
        if (!mapList[map]) mapList[map] = { win: 0, lose: 0 };

        const isFaction1 = Boolean(
          match.teams.faction1.players.map(({ player_id }) => player_id).find(playerId => playersId.includes(playerId))
        );
        const hasFaction1Won = match.results.score.faction1;
        const teamHasWon = (isFaction1 && hasFaction1Won) || (!isFaction1 && !hasFaction1Won);

        teamHasWon ? mapList[map].win++ : mapList[map].lose++;
      })
    );

    return Object.keys(mapList)
      .filter(mapName => maps.includes(mapName))
      .map(mapName => {
        const currentMap = mapList[mapName];
        return {
          name: mapName,
          ...currentMap,
          winRate: currentMap.win === 0 ? 0 : parseInt((currentMap.win / (currentMap.win + currentMap.lose)) * 100),
        };
      })
      .sort((a, b) => (a.winRate > b.winRate ? -1 : 1));
  };

  const result = await Promise.all(
    teams.map(async team => {
      const maps = await getMapsWinrate(team.playersId);
      return {
        name: team.name,
        maps,
      };
    })
  );

  chrome.runtime.sendMessage({
    message: 'result',
    data: result,
  });
})();
