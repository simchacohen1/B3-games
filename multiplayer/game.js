(function () {
  'use strict';
  const GAMES = {
    'connect-four': { name: 'Connect 4', icon: '🔴', minPlayers: 2, columns: 7, rows: 6 },
    'tic-tac-toe': { name: 'Tic Tac Toe', icon: '⭕', minPlayers: 2, columns: 3, rows: 3 },
    'memory-match': { name: 'Memory Match', icon: '🧠', minPlayers: 2, columns: 4, rows: 4 },
    checkers: { name: 'Checkers', icon: '🔴', minPlayers: 2, columns: 8, rows: 8 },
    reversi: { name: 'Reversi', icon: '⚫', minPlayers: 2, columns: 8, rows: 8 },
    bingo: { name: 'Bingo', icon: '🎯', minPlayers: 2, columns: 5, rows: 5 },
    'math-race': { name: 'Math Race', icon: '➕', minPlayers: 2 },
    set: { name: 'Set', icon: '🟣', minPlayers: 2 },
    ludo: { name: 'Ludo', icon: '🎲', minPlayers: 2 },
    dominoes: { name: 'Dominoes', icon: '🁣', minPlayers: 2 },
    'go-fish': { name: 'Go Fish', icon: '🐟', minPlayers: 2 },
    'uno-style': { name: 'Uno-style Cards', icon: '🃏', minPlayers: 2 },
  };
  const params = new URLSearchParams(location.search);
  const gameKey = params.get('game') || '';
  const game = GAMES[gameKey];
  const el = id => document.getElementById(id);
  const title = el('gameTitle'), hint = el('gameHint'), message = el('message'), roomSection = el('room');
  const board = el('board'), actions = el('actions');
  let db = null, callable = null, classInfo = null, studentId = '', roomCode = '', room = null, privateHand = [], privateCard = null, ref = null, privateRef = null, listener = null, privateListener = null, pending = false, authReady = false, selectedChecker = null, selectedSet = [], askRank = null, selectedUno = null, mathDraft = '', classmates = null, invitePickerOpen = false;

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }
  function button(label, handler, className = 'btn', disabled = false) {
    const node = text('button', className, label);
    node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', handler);
    return node;
  }
  function notice(value, isError = false) {
    message.className = 'notice' + (isError ? ' error' : '');
    message.textContent = value;
  }
  function backToCenter() { location.assign('index.html'); }
  function call(action, extra = {}) {
    if (!callable || pending) return Promise.reject(new Error('Please wait for the previous action to finish.'));
    pending = true;
    drawActions();
    return callable({ action, gameKey, workspaceId: classInfo.workspaceId, roomCode, ...extra })
      .then(result => result.data || {})
      .finally(() => { pending = false; draw(); });
  }
  function listen(code) {
    roomCode = code;
    const roomPath = `multiplayerCenter/workspaces/${classInfo.workspaceId}/classes/${classInfo.classId}/strategyRooms/${roomCode}`;
    ref = db.ref(roomPath);
    listener = ref.on('value', snapshot => {
      room = snapshot.val();
      if (params.get('b3Multiplayer') === 'spectate' && room && !room.allowSpectators &&
          !(room.players || []).some(player => player.studentId === studentId)) {
        unlisten(); notice('The host turned off spectator mode. Choose another game.', true);
        roomSection.hidden = true; showBrowse(); return;
      }
      if (!room || ['closed'].includes(room.state)) {
        unlisten(); notice('This game room has closed. You can choose another game.'); roomSection.hidden = true; showBrowse(); return;
      }
      roomSection.hidden = false;
      // Keep the saved URL's role in sync after winner/challenger rotation.
      // A former player becomes a spectator; a queued spectator becomes a player.
      const currentPlayer = (room.players || []).some(player => player.studentId === studentId);
      const desiredMode = currentPlayer ? (room.host === studentId ? 'host' : 'join') : 'spectate';
      if (params.get('b3Multiplayer') !== desiredMode) {
        params.set('b3Multiplayer', desiredMode);
        history.replaceState(null, '', location.pathname + '?' + params.toString());
      }
      el('roomCode').textContent = 'Room code ' + roomCode;
      draw();
    }, () => notice('The game connection was interrupted. Refresh to reconnect.', true));
    if (['bingo', 'dominoes', 'go-fish', 'uno-style'].includes(gameKey)) {
      privateRef = db.ref(`b3Private/multiplayerGames/workspaces/${classInfo.workspaceId}/classes/${classInfo.classId}/rooms/${roomCode}/hands/${studentId}`);
      privateListener = privateRef.on('value', snapshot => {
        const privateData = snapshot.val() || {};
        privateHand = privateData.hand || [];
        privateCard = privateData.card || null;
        draw();
      }, () => notice('Your private game information could not be loaded. Refresh to reconnect.', true));
    }
  }
  function unlisten() { if (ref && listener) ref.off('value', listener); if (privateRef && privateListener) privateRef.off('value', privateListener); ref = listener = privateRef = privateListener = null; }
  function clearSavedRejoin(code) {
    try {
      const key = 'fttMultiplayerRejoin:' + studentId, saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved?.roomCode === code) sessionStorage.removeItem(key);
    } catch (e) {}
  }
  function statusText() {
    if (!room) return 'Connecting…';
    const watching = !(room.players || []).some(player => player.studentId === studentId);
    if (watching) {
      if (!room.allowSpectators) return 'The host has ended spectator access.';
      if (room.state === 'lobby') return 'Watching the room. The players are getting ready.';
      if (room.state === 'finished') return room.draw ? 'The match ended in a draw.' :
        ((room.players || []).find(player => player.studentId === room.winner)?.name || 'A player') + ' won!';
      return 'Spectator mode — you can watch the game and request to play the winner.';
    }
    if (room.state === 'lobby') return room.host === studentId ? 'Waiting for classmates. You start the game when everyone is ready.' : 'Waiting for the host to start.';
    if (room.finished || room.state === 'finished') return room.draw ? 'It’s a draw!' : (room.winner === studentId ? 'You won! Great game.' : ((room.players || []).find(p => p.studentId === room.winner)?.name || 'A classmate') + ' won this game.');
    if (gameKey === 'math-race') return 'Solve the question with your classmates.';
    if (gameKey === 'set') return 'Find a set of three cards.';
    if (gameKey === 'bingo') return room.host === studentId ? 'Draw numbers for the class.' : 'Your card marks called numbers automatically.';
    if (gameKey === 'dominoes') return room.turn === studentId ? 'Your turn. Match either end of the table.' : ((room.players || []).find(player => player.studentId === room.turn)?.name || 'A classmate') + ' is choosing a tile.';
    if (gameKey === 'go-fish') return room.turn === studentId ? 'Your turn. Ask a classmate for a card rank.' : ((room.players || []).find(player => player.studentId === room.turn)?.name || 'A classmate') + ' is asking for cards.';
    if (gameKey === 'uno-style') return room.turn === studentId ? 'Your turn. Match a color or number.' : ((room.players || []).find(player => player.studentId === room.turn)?.name || 'A classmate') + ' is playing a card.';
    const current = (room.players || []).find(player => player.studentId === room.turn);
    return current ? (current.studentId === studentId ? 'Your turn!' : current.name + ' is taking a turn.') : 'Game in progress.';
  }
  function drawPlayers() {
    const parent = el('players'); parent.replaceChildren();
    (room?.players || []).forEach(player => {
      const chip = text('span', 'player-chip' + (player.studentId === room.turn ? ' current' : ''), player.name + (player.studentId === studentId ? ' (you)' : ''));
      parent.appendChild(chip);
    });
  }
  async function loadClassmates() {
    invitePickerOpen = true;
    if (classmates === null) {
      try { classmates = (await call('classmates')).classmates || []; }
      catch (error) { invitePickerOpen = false; showError(error); }
    }
    draw();
  }
  function spectatorControls() {
    const watching = !(room.players || []).some(player => player.studentId === studentId);
    const queue = room.winnerQueue || [];
    if (!watching) return false;
    actions.append(text('div', 'player-turn', statusText()));
    if (room.allowSpectators && (room.players || []).length >= 2) {
      const index = queue.indexOf(studentId);
      if (index >= 0) {
        actions.append(text('span', 'spectator-queue-status', 'Play-winner queue: #' + (index + 1)));
        actions.append(button('Leave winner queue', () => call('unqueue-winner').catch(showError), 'quiet', pending));
      } else {
        actions.append(button('🏆 Play the winner next', () => call('queue-winner').catch(showError), 'btn', pending));
      }
    }
    actions.append(button('Leave spectator mode', leaveRoom, 'quiet', pending));
    return true;
  }
  function drawActions() {
    actions.replaceChildren();
    if (!room) return;
    const ids = (room.players || []).map(player => player.studentId);
    if (spectatorControls()) return;
    const isTwoPlayer = room.maxPlayers === 2;
    if (isTwoPlayer && room.host === studentId && ['lobby', 'playing', 'finished'].includes(room.state)) {
      actions.append(button(room.allowSpectators ? '👀 Spectators: On (turn off)' : '👀 Allow spectators: Off (turn on)',
        () => call('spectators', { move: { allow: !room.allowSpectators } }).catch(showError), 'quiet', pending));
    }
    if (room.state === 'lobby') {
      if (room.host === studentId) {
        actions.append(button('Start game', () => call('start').catch(showError), 'btn', pending || ids.length < game.minPlayers));
        if (isTwoPlayer && ids.length === 1) {
          actions.append(button('Invite a specific classmate', loadClassmates, 'quiet', pending));
          if (room.invitedStudentName) actions.append(text('span', 'invite-status', 'Invitation reserved for ' + room.invitedStudentName));
          if (invitePickerOpen) {
            const chooser = text('select', 'invite-classmate-select');
            chooser.setAttribute('aria-label', 'Choose a classmate to invite');
            chooser.appendChild(new Option('Choose a classmate…', ''));
            (classmates || []).forEach(person => {
              const option = new Option(person.name, person.studentId);
              if (person.studentId === room.invitedStudentId) option.selected = true;
              chooser.appendChild(option);
            });
            actions.appendChild(chooser);
            actions.append(button('Send direct invitation', () => {
              if (!chooser.value) return notice('Choose a classmate first.', true);
              call('invite-target', { move: { studentId: chooser.value } })
                .then(() => { invitePickerOpen = false; notice('Personal invitation sent to that classmate’s Multiplayer Arcade.'); })
                .catch(showError);
            }, 'btn', pending || !classmates?.length));
            if (room.invitedStudentId) actions.append(button('Open spot to everyone', () =>
              call('invite-target', { move: { studentId: '' } }).then(() => { invitePickerOpen = false; }).catch(showError),
              'quiet', pending));
          }
        }
        actions.append(button('Close room', leaveRoom, 'quiet', pending));
      } else actions.append(button('Leave game', leaveRoom, 'quiet', pending));
      actions.append(button('Browse other games', leaveRoom, 'quiet', pending));
      return;
    }
    if (room.finished || room.state === 'finished') {
      if (isTwoPlayer && room.winner === studentId && (room.winnerQueue || []).length && room.allowSpectators) {
        actions.append(button('🏆 Play the next challenger', () => call('next-round').catch(showError), 'btn', pending));
      }
      if (isTwoPlayer && room.draw) {
        actions.append(button('Rematch after the draw', () => call('rematch-draw').catch(showError), 'btn', pending));
      }
      actions.append(button('Play again in a new room', () => { unlisten(); location.assign(`game.html?game=${encodeURIComponent(gameKey)}&b3Multiplayer=start`); }, 'btn'));
      actions.append(button('Browse other games', leaveRoom, 'quiet', pending));
      return;
    }
    if (room.state === 'playing') {
      actions.append(text('div', 'player-turn', statusText()));
      if (isTwoPlayer && room.allowSpectators && room.winnerQueue?.length)
        actions.append(text('span', 'spectator-queue-status', room.winnerQueue.length + ' spectator(s) waiting to play the winner'));
      if (gameKey === 'bingo' && room.host === studentId) actions.append(button('Draw next number', () => call('move', { move: { type: 'draw' } }).catch(showError), 'btn', pending));
      if (gameKey === 'dominoes' && room.turn === studentId) actions.append(button('Draw a tile', () => call('move', { move: { type: 'draw' } }).catch(showError), 'btn', pending));
      if (gameKey === 'uno-style' && room.turn === studentId) {
        const label = room.drawPending ? `Draw ${room.drawPending} cards` : 'Draw a card';
        actions.append(button(label, () => call('move', { move: { type: room.drawPending ? 'draw-penalty' : 'draw' } }).catch(showError), 'btn', pending));
        if (selectedUno != null) for (const color of ['red','yellow','green','blue']) actions.append(button(color, () => call('move', { move: { type: 'play', index: selectedUno, color } }).then(() => { selectedUno = null; }).catch(showError), 'quiet', pending));
      }
      if (gameKey === 'ludo' && room.turn === studentId) {
        if (room.lastRoll == null) actions.append(button('Roll die', () => call('move', { move: { type: 'roll' } }).catch(showError), 'btn', pending));
        else actions.append(text('div', 'player-turn', 'You rolled ' + room.lastRoll + '. Choose a token.'));
      }
      actions.append(button('Leave game', leaveRoom, 'quiet', pending));
      actions.append(button('Browse other games', leaveRoom, 'quiet', pending));
    }
  }
  function cell(label, className, onClick, disabled) {
    const node = button(label, onClick, 'board-cell ' + (className || ''), disabled || pending);
    node.setAttribute('aria-label', label ? 'Card ' + label : 'Empty square');
    return node;
  }
  function drawBoard() {
    board.replaceChildren();
    if (!room || room.state !== 'playing' && room.state !== 'finished') return;
    if (room.finished || room.state === 'finished') board.appendChild(text('div', 'game-result', statusText()));
    if (gameKey === 'connect-four') {
      const grid = text('div', 'board connect-board');
      const ownTurn = room.turn === studentId && !room.finished;
      for (let index = 0; index < 42; index += 1) {
        const value = room.board?.[index], selected = value === 'red' ? 'disc-red' : value === 'yellow' ? 'disc-yellow' : '';
        grid.appendChild(cell('', selected, () => call('move', { move: { type: 'drop', column: index % 7 } }).catch(showError), !ownTurn || !!value));
      }
      board.appendChild(grid);
    } else if (gameKey === 'tic-tac-toe') {
      const grid = text('div', 'board tic-board');
      const ownTurn = room.turn === studentId && !room.finished;
      (room.board || Array(9).fill(null)).forEach((value, index) => {
        const mark = value || '';
        grid.appendChild(cell(mark, mark === 'X' ? 'mark-x' : 'mark-o', () => call('move', { move: { type: 'place', index } }).catch(showError), !ownTurn || !!value));
      });
      board.appendChild(grid);
    } else if (gameKey === 'memory-match') {
      const grid = text('div', 'board memory-board');
      const visible = new Map((room.visibleCards || []).map(card => [card.index, card.face]));
      const matched = new Set(room.matched || []), flipped = new Set(room.flipped || []), ownTurn = room.turn === studentId && !room.finished;
      for (let index = 0; index < (room.cardCount || 16); index += 1) {
        const faceUp = matched.has(index) || flipped.has(index);
        grid.appendChild(cell(faceUp ? (visible.get(index) || '⭐') : '?', matched.has(index) ? 'matched-card' : '', () => call('move', { move: { type: 'flip', index } }).catch(showError), !ownTurn || faceUp));
      }
      const scores = (room.players || []).map(player => `${player.name}: ${player.score || 0}`).join(' · ');
      board.append(grid, text('div', 'player-turn', scores));
    } else if (gameKey === 'checkers') {
      const grid = text('div', 'board strategy-board');
      const ownTurn = room.turn === studentId && !room.finished;
      for (let index = 0; index < 64; index += 1) {
        const piece = room.board?.[index] || '', own = piece.startsWith(room.playersOrder?.[0] === studentId ? 'red' : 'yellow');
        const label = piece ? (piece.endsWith('-king') ? '♛' : '●') : '';
        const square = (Math.floor(index / 8) + index % 8) % 2 ? 'dark-square ' : 'light-square ';
        const color = piece ? (piece.startsWith('red') ? 'piece-red' : 'piece-yellow') : '';
        const selected = selectedChecker === index ? ' selected-square' : '';
        grid.appendChild(cell(label, square + color + selected, () => {
          if (own) { selectedChecker = index; draw(); return; }
          if (selectedChecker != null) { const from = selectedChecker; selectedChecker = null; call('move', { move: { type: 'move', from, to: index } }).catch(showError); }
        }, !ownTurn || (!own && selectedChecker == null)));
      }
      board.append(grid);
    } else if (gameKey === 'reversi') {
      const grid = text('div', 'board strategy-board');
      const ownTurn = room.turn === studentId && !room.finished;
      (room.board || Array(64).fill(null)).forEach((value, index) => {
        const disc = value === 'red' ? '●' : value === 'yellow' ? '○' : '';
        const square = (Math.floor(index / 8) + index % 8) % 2 ? 'dark-square ' : 'light-square ';
        const color = value === 'red' ? 'piece-red' : value === 'yellow' ? 'piece-yellow' : '';
        grid.appendChild(cell(disc, square + color, () => call('move', { move: { type: 'place', index } }).catch(showError), !ownTurn || !!value));
      });
      board.append(grid);
    } else if (gameKey === 'bingo') {
      const card = privateCard;
      if (room.called?.length) board.appendChild(text('div', 'player-turn', 'Called: ' + room.called[room.called.length - 1] + ' · ' + room.called.length + ' numbers'));
      const grid = text('div', 'board bingo-board');
      if (card?.board) card.board.forEach((number, index) => {
        const marked = card.marked?.includes(index);
        grid.appendChild(cell(index === 12 ? 'FREE' : String(number), marked ? 'bingo-marked' : '', () => {}, true));
      });
      board.append(grid, text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${player.score ? 'BINGO!' : 'playing'}`).join(' · ')));
    } else if (gameKey === 'math-race') {
      const question = room.question;
      if (question) {
        board.append(text('div', 'game-result', question.prompt), text('div', 'player-turn', `Question ${question.index} of ${question.total} · ${question.answered} answered`));
        const entry = document.createElement('input'); entry.type = 'number'; entry.inputMode = 'numeric'; entry.id = 'mathAnswer'; entry.className = 'math-answer'; entry.value = mathDraft; entry.setAttribute('aria-label', 'Your answer');
        entry.addEventListener('input', () => { mathDraft = entry.value; });
        board.appendChild(entry);
        const send = button('Submit answer', () => {
          const answer = Number(entry.value);
          call('move', { move: { type: 'answer', answer } }).then(() => { mathDraft = ''; entry.value = ''; }).catch(showError);
        }, 'btn', pending || !!room.finished);
        board.appendChild(send);
      }
      board.appendChild(text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${player.score || 0} points`).join(' · ')));
    } else if (gameKey === 'set') {
      const grid = text('div', 'board set-board');
      (room.cards || []).forEach((card, index) => {
        const shape = ['●','◆','■'][card.props[0]], color = ['🔴','🟣','🟢'][card.props[1]], fill = ['○','◍','●'][card.props[2]];
        const label = Array(card.props[3] + 1).fill(shape + color + fill).join('  ');
        const selected = selectedSet.includes(index);
        grid.appendChild(cell(label, selected ? 'set-selected' : '', () => {
          selectedSet = selected ? selectedSet.filter(item => item !== index) : selectedSet.length < 3 ? [...selectedSet, index] : [index];
          if (selectedSet.length === 3) {
            const indices = selectedSet.slice(); selectedSet = [];
            call('move', { move: { type: 'claim', indices } }).catch(showError);
          } else draw();
        }, pending || !!room.finished));
      });
      board.append(grid, text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${player.score || 0} sets`).join(' · ')));
    } else if (gameKey === 'ludo') {
      const list = text('div', 'ludo-list');
      (room.players || []).forEach(player => {
        const own = player.studentId === studentId;
        const row = text('div', 'ludo-row'); row.appendChild(text('strong', '', player.name));
        (room.tokens?.[player.studentId] || [-1,-1,-1,-1]).forEach((position, index) => {
          const label = position < 0 ? 'Home' : position >= 51 ? `Home ${position - 50}/7` : `Track ${position + 1}`;
          row.appendChild(button(`Token ${index + 1}: ${label}`, () => call('move', { move: { type: 'token', token: index } }).catch(showError), 'ludo-token', pending || !own || room.turn !== studentId || room.lastRoll == null || !!room.finished));
        });
        list.appendChild(row);
      });
      board.appendChild(list);
    } else if (gameKey === 'dominoes') {
      const ownTurn = room.turn === studentId && !room.finished;
      board.append(text('div', 'game-result', 'Table'), text('div', 'domino-line', (room.layout || []).map(tile => `${tile.a} | ${tile.b}`).join('   ·   ')));
      board.appendChild(text('div', 'player-turn', 'Tiles left to draw: ' + (room.boneyardCount || 0)));
      const hand = text('div', 'card-hand');
      privateHand.forEach((tile, index) => {
        for (const end of ['left','right']) hand.appendChild(button(`${tile.a} | ${tile.b} ${end === 'left' ? '←' : '→'}`, () => call('move', { move: { type: 'play', index, end } }).catch(showError), 'playing-card', pending || !ownTurn));
      });
      board.appendChild(hand);
      board.appendChild(text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${room.handCounts?.[player.studentId] || 0} tiles`).join(' · ')));
    } else if (gameKey === 'go-fish') {
      const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'], groups = new Map();
      privateHand.forEach(card => groups.set(card.rank, (groups.get(card.rank) || 0) + 1));
      board.append(text('div', 'game-result', 'Your cards'), text('div', 'player-turn', 'Books collected: ' + (room.bookCounts?.[studentId] || 0) + ' · Cards in the pond: ' + room.deckCount));
      const hand = text('div', 'card-hand');
      [...groups.entries()].forEach(([rank, count]) => hand.appendChild(button(`${ranks[rank]} (${count})`, () => { askRank = rank; drawBoard(); }, 'playing-card' + (askRank === rank ? ' selected-card' : ''), room.turn !== studentId || pending)));
      board.appendChild(hand);
      if (askRank != null && room.turn === studentId) {
        board.appendChild(text('div', 'player-turn', 'Ask a classmate for ' + ranks[askRank]));
        const targets = text('div', 'card-hand');
        (room.players || []).filter(player => player.studentId !== studentId && (room.handCounts?.[player.studentId] || 0) > 0).forEach(player => targets.appendChild(button('Ask ' + player.name, () => call('move', { move: { type: 'ask', rank: askRank, target: player.studentId } }).then(() => { askRank = null; }).catch(showError), 'btn', pending)));
        board.appendChild(targets);
      }
      board.appendChild(text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${room.bookCounts?.[player.studentId] || 0} books · ${room.handCounts?.[player.studentId] || 0} cards`).join(' · ')));
    } else if (gameKey === 'uno-style') {
      const ownTurn = room.turn === studentId && !room.finished, top = room.topCard;
      board.append(text('div', 'game-result', 'Current color: ' + (room.color || '—')), text('div', 'player-turn', 'Top card: ' + (top ? `${top.color || 'wild'} ${top.value}` : '—')));
      if (room.drawPending) board.appendChild(text('div', 'player-turn', 'Draw ' + room.drawPending + ' cards before your turn.'));
      const hand = text('div', 'card-hand');
      privateHand.forEach((card, index) => hand.appendChild(button(`${card.color || 'Wild'} · ${card.value}`, () => {
        if (!ownTurn) return;
        if (card.kind === 'wild' || card.kind === 'wild4') { selectedUno = index; drawActions(); return; }
        call('move', { move: { type: 'play', index } }).catch(showError);
      }, 'playing-card card-' + (card.color || 'wild'), pending || !ownTurn || !!room.drawPending)));
      board.appendChild(hand);
      board.appendChild(text('div', 'player-turn', (room.players || []).map(player => `${player.name}: ${room.handCounts?.[player.studentId] || 0} cards`).join(' · ')));
    }
  }
  function draw() {
    if (!room) return;
    el('roomState').textContent = statusText();
    drawPlayers(); drawBoard(); drawActions();
  }
  function showError(error) { notice(String(error?.message || error || 'The game action could not be saved.'), true); }
  async function leaveRoom() {
    if (pending) return;
    try {
      if (roomCode) {
        await call('leave');
        if (room && room.host !== studentId && ['lobby', 'playing'].includes(room.state)) {
          sessionStorage.setItem('fttMultiplayerRejoin:' + studentId, JSON.stringify({ gameKey, roomCode }));
        }
      }
    } catch (error) { console.warn('Game leave failed:', error); }
    unlisten(); backToCenter();
  }
  function showBrowse() {
    actions.replaceChildren(button('Browse other games', backToCenter));
  }
  async function launch() {
    const savedId = String(sessionStorage.getItem('b3Games_studentId') || sessionStorage.getItem('posukPractice_studentId') || '').trim();
    if (!savedId || !window.firebase || !window.B3_FIREBASE_CONFIG || !game) {
      notice(game ? 'Sign in on Fun Torah Tools first. ' : 'Choose a game from the Multiplayer Center.', true);
      showBrowse(); return;
    }
    studentId = savedId;
    title.textContent = game.icon + ' ' + game.name;
    document.title = game.name + ' — Fun Torah Tools';
    hint.textContent = gameKey === 'memory-match' ? 'Flip cards to find pairs. A match earns another turn.' : gameKey === 'bingo' ? 'The host draws numbers. Your card is marked as numbers are called.' : gameKey === 'go-fish' ? 'Ask for a rank already in your hand and collect four-of-a-kind books.' : gameKey === 'uno-style' ? 'Play a matching color or number. Wild cards let you pick a color.' : 'Take turns, make your move, and see who wins!';
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
      db = firebase.database();
      firebase.auth().onAuthStateChanged(async user => {
        if (authReady) return;
        authReady = true;
        if (!user) { notice('Your saved sign-in expired. Please sign in again.', true); showBrowse(); return; }
        try {
          const token = await user.getIdTokenResult();
          classInfo = await window.FunTorahStudentClass.resolve(db, studentId);
          if (!classInfo.classId || token.claims.b3StudentId !== studentId || token.claims.b3ClassId !== classInfo.classId) throw new Error('A current student sign-in for your class is required.');
          const member = (await db.ref(`b3Games/workspaces/${classInfo.workspaceId}/classes/${classInfo.classId}/members/${studentId}`).once('value')).val() || {};
          let centerEnabled = member.active !== false && member.toolAccess?.['multiplayer-center'] !== false;
          if (['et', 'wt'].includes(classInfo.classId)) {
            const settings = (await db.ref('b3Games/siteSettings').once('value')).val() || {};
            centerEnabled = centerEnabled && settings.games?.['multiplayer-center'] !== false && settings.classGames?.[classInfo.classId]?.['multiplayer-center'] !== false;
          } else {
            const classGrant = (await db.ref(`b3Games/workspaces/${classInfo.workspaceId}/classes/${classInfo.classId}/toolGrants/multiplayer-center`).once('value')).val() === true;
            centerEnabled = centerEnabled && classGrant;
          }
          if (!centerEnabled) throw new Error('Your teacher has not enabled Multiplayer Center for you yet.');
          if (typeof firebase.functions !== 'function') throw new Error('The secure multiplayer service did not load. Reload the page to try again.');
          callable = firebase.app().functions('us-central1').httpsCallable('multiplayerGameAction');
          const code = params.get('b3MultiplayerRoom');
          if (code) {
            roomCode = code;
            const isWatching = params.get('b3Multiplayer') === 'spectate';
            const result = await call(isWatching ? 'spectate' : 'join');
            clearSavedRejoin(code);
            if (result.public?.state === 'closed') throw new Error('That room has closed.');
            const mode = isWatching ? 'spectate' : (result.public?.host === studentId ? 'host' : 'join');
            params.set('b3Multiplayer', mode);
            history.replaceState(null, '', location.pathname + '?' + params.toString());
            listen(code); notice(isWatching ? 'You are watching this match as a spectator.' : 'Connected to your class game.');
          } else if (params.get('b3Multiplayer') === 'start' || !params.has('b3Multiplayer')) {
            const result = await call('create');
            const next = new URL(location.href); next.searchParams.set('b3Multiplayer', 'host'); next.searchParams.set('b3MultiplayerRoom', result.roomCode);
            history.replaceState(null, '', next.href);
            listen(result.roomCode); notice('Room ready. Your classmates can join from their invitations.');
          } else throw new Error('Open this game from the Multiplayer Center.');
          roomSection.hidden = false;
        } catch (error) { showError(error); showBrowse(); }
      });
    } catch (error) { showError(error); showBrowse(); }
  }
  window.addEventListener('pagehide', unlisten);
  launch();
})();
