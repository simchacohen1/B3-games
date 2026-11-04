(function () {
  'use strict';
  const GAMES = {
    'connect-four': { name: 'Connect 4', icon: '🔴', minPlayers: 2, maxPlayers: 2, columns: 7, rows: 6, computerOpponent: true },
    'tic-tac-toe': { name: 'Tic Tac Toe', icon: '⭕', minPlayers: 2, maxPlayers: 2, columns: 3, rows: 3, computerOpponent: true },
    'memory-match': { name: 'Memory Match', icon: '🧠', minPlayers: 2, columns: 4, rows: 4 },
    checkers: { name: 'Checkers', icon: '🔴', minPlayers: 2, maxPlayers: 2, columns: 8, rows: 8 },
    reversi: { name: 'Othello', icon: '⚫', minPlayers: 2, maxPlayers: 2, columns: 8, rows: 8 },
    bingo: { name: 'Bingo', icon: '🎯', minPlayers: 2, columns: 5, rows: 5 },
    'math-race': { name: 'Math Race', icon: '➕', minPlayers: 2 },
    set: { name: 'Set', icon: '🟣', minPlayers: 2 },
    ludo: { name: 'Ludo', icon: '🎲', minPlayers: 2 },
    dominoes: { name: 'Dominoes', icon: '🁣', minPlayers: 2 },
    'go-fish': { name: 'Go Fish', icon: '🐟', minPlayers: 2 },
    'uno-style': { name: 'Uno-style Cards', icon: '🃏', minPlayers: 2 },
    chess: { name: 'Chess', icon: '♞', minPlayers: 2, maxPlayers: 2, columns: 8, rows: 8 },
    'chess-5min': { name: 'Chess: 5 Minutes', icon: '♞', minPlayers: 2, maxPlayers: 2, columns: 8, rows: 8 },
  };
  const params = new URLSearchParams(location.search);
  const gameKey = params.get('game') || '';
  const game = GAMES[gameKey];
  const el = id => document.getElementById(id);
  const title = el('gameTitle'), hint = el('gameHint'), message = el('message'), roomSection = el('room');
  const board = el('board'), actions = el('actions');
  let db = null, callable = null, classInfo = null, studentId = '', roomCode = '', room = null, privateHand = [], privateCard = null, ref = null, privateRef = null, listener = null, privateListener = null, pending = false, authReady = false, selectedChecker = null, selectedSet = [], askRank = null, selectedUno = null, mathDraft = '', countdownTimer = null, countdownRetryTimer = null, countdownStarting = false, settlementRetryTimer = null, settlementInFlight = '', settledRoomCode = '', settlementRetries = 0;

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
    return callable({ action, gameKey, workspaceId: classInfo.workspaceId, classId: classInfo.classId, roomCode, ...extra })
      .then(result => result.data || {})
      .finally(() => { pending = false; draw(); });
  }
  function activePlayerCount(value) { return (value?.players || []).filter(player => player && player.active !== false).length; }
  function setTitle() {
    title.replaceChildren();
    const art = window.FTT_GAME_ART?.illustration?.({ key: gameKey, icon: game.icon });
    if (art) { const wrap = text('span', 'game-title-art'); wrap.append(art); title.append(wrap); } else title.append(game.icon + ' ');
    title.append(game.name);
  }
  function listen(code) {
    roomCode = code;
    const roomPath = `multiplayerCenter/workspaces/${classInfo.workspaceId}/classes/${classInfo.classId}/strategyRooms/${roomCode}`;
    ref = db.ref(roomPath);
    listener = ref.on('value', snapshot => {
      room = snapshot.val();
      if (!room || ['closed'].includes(room.state)) {
        unlisten(); notice('This game room has closed. You can choose another game.'); roomSection.hidden = true; showBrowse(); return;
      }
      roomSection.hidden = false;
      el('roomCode').textContent = 'Room code ' + roomCode;
      if (room.state === 'countdown' && Number.isFinite(Number(room.countdownAt)) && activePlayerCount(room) >= 2) runCountdown(room.countdownAt);
      else { clearInterval(countdownTimer); clearTimeout(countdownRetryTimer); countdownTimer = countdownRetryTimer = null; countdownStarting = false; el('countdown').hidden = true; }
      draw();
      if (room.state === 'finished') settleFinishedRoom();
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
  function unlisten() { if (ref && listener) ref.off('value', listener); if (privateRef && privateListener) privateRef.off('value', privateListener); clearInterval(countdownTimer); clearTimeout(countdownRetryTimer); clearTimeout(settlementRetryTimer); countdownTimer = countdownRetryTimer = settlementRetryTimer = null; ref = listener = privateRef = privateListener = null; }
  function clearSavedRejoin(code) {
    try {
      const key = 'fttMultiplayerRejoin:' + studentId, saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved?.roomCode === code) sessionStorage.removeItem(key);
    } catch (e) {}
  }
  function statusText() {
    if (!room) return 'Connecting…';
    if (room.state === 'lobby') return room.host === studentId ? 'Waiting for classmates. You start the game when everyone is ready.' : 'Waiting for the host to start.';
    if ((gameKey === 'chess' || gameKey === 'chess-5min') && (room.finished || room.state === 'finished')) return chessResultText();
    if (room.finished || room.state === 'finished') return room.draw ? 'It’s a draw!' : (room.winner === studentId ? 'You won! Great game.' : ((room.players || []).find(p => p.studentId === room.winner)?.name || 'A classmate') + ' won this game.');
    if (gameKey === 'chess' || gameKey === 'chess-5min') return chessStatusText();
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
      const chip = text('span', 'player-chip' + (player.studentId === room.turn ? ' current' : ''), player.name + (player.role === 'teacher' ? ' (teacher)' : '') + (player.studentId === studentId ? ' (you)' : ''));
      parent.appendChild(chip);
    });
    (room?.spectators || []).forEach(spectator => parent.appendChild(text('span', 'player-chip', '👀 ' + spectator.name + ' (watching)')));
  }
  function addSpectatorControls() {
    if (!room?.allowSpectators || (room.players || []).some(player => player.studentId === studentId)) return;
    const queued = (room.winnerQueue || []).includes(studentId);
    actions.append(button(queued ? 'Leave the play-next line' : 'Play the winner next', () =>
      call(queued ? 'unqueue-winner' : 'queue-winner').catch(showError), 'quiet', pending || room.state !== 'playing'));
    actions.append(button('Leave as spectator', leaveRoom, 'quiet', pending));
  }
  function addHostRoomOptions() {
    if (room.host !== studentId || game?.maxPlayers !== 2) return;
    const spectatorToggle = button(room.allowSpectators ? 'Turn off spectators' : 'Allow classmates to watch', () =>
      call('spectators', { move: { allow: !room.allowSpectators } }).catch(showError), 'quiet', pending);
    actions.append(spectatorToggle);
    if (room.state !== 'lobby' || room.players.length > 1) return;
    const selector = document.createElement('select'); selector.setAttribute('aria-label', 'Choose a classmate to invite');
    selector.appendChild(text('option', '', 'Choose a classmate to invite…')); selector.options[0].value = '';
    const load = button('Load classmates', () => call('classmates').then(result => {
      selector.replaceChildren();
      const none = text('option', '', room.invitedStudentId ? 'Clear personal invitation' : 'Choose a classmate to invite…'); none.value = ''; selector.appendChild(none);
      (result.classmates || []).forEach(person => { const option = text('option', '', person.name); option.value = person.studentId; selector.appendChild(option); });
      if (room.invitedStudentId) selector.value = room.invitedStudentId;
    }).catch(showError), 'quiet', pending);
    const invite = button('Send personal invite', () => {
      if (invite.disabled) return;
      call('invite-target', { move: { studentId: selector.value } }).then(() => notice(selector.value ? 'Personal invitation reserved for your classmate.' : 'Personal invitation cleared.')).catch(showError);
    }, 'btn', pending);
    actions.append(selector, load, invite);
    if (room.invitedStudentName) actions.append(text('div', 'player-turn', 'Waiting for ' + room.invitedStudentName + '. They are saved from random matchmaking.'));
  }
  function drawActions() {
    actions.replaceChildren();
    if (!room) return;
    const ids = (room.players || []).map(player => player.studentId);
    if (room.state === 'countdown') { actions.append(text('div', 'player-turn', 'Your classmate is here. Game starts together!')); return; }
    if (room.state === 'lobby') {
      if (room.host === studentId) {
        actions.append(button('Start game', () => call('start').catch(showError), 'btn', pending || ids.length < game.minPlayers));
        actions.append(button('Close room', leaveRoom, 'quiet', pending));
      } else actions.append(button('Leave game', leaveRoom, 'quiet', pending));
      addHostRoomOptions();
      addSpectatorControls();
      actions.append(button('Browse other games', leaveRoom, 'quiet'));
      return;
    }
    if (room.finished || room.state === 'finished') {
      if (studentId === room.winner && room.winnerQueue?.length && room.allowSpectators) {
        actions.append(button('🏆 Play the next challenger', () => call('next-round').catch(showError), 'btn', pending));
      }
      if (room.draw && ids.includes(studentId)) actions.append(button('Rematch after the draw', () => call('rematch-draw').catch(showError), 'btn', pending));
      addSpectatorControls();
      actions.append(button('Play again', () => { unlisten(); location.assign(`game.html?game=${encodeURIComponent(gameKey)}&b3Multiplayer=start`); }, 'btn'));
      actions.append(button('Browse other games', leaveRoom, 'quiet'));
      return;
    }
    if (room.state === 'playing') {
      if (!ids.includes(studentId)) { addSpectatorControls(); return; }
      actions.append(text('div', 'player-turn', statusText()));
      if (game?.maxPlayers === 2 && room.allowSpectators && room.winnerQueue?.length) actions.append(text('div', 'player-turn', room.winnerQueue.length + ' classmate(s) are waiting to play the winner.'));
      if (gameKey === 'bingo' && room.host === studentId) actions.append(button('Draw next number', () => call('move', { move: { type: 'draw' } }).catch(showError), 'btn', pending));
      if (gameKey === 'dominoes' && room.turn === studentId) {
        actions.append(button('Draw a tile', () => { selectedDom = null; call('move', { move: { type: 'draw' } }).catch(showError); }, 'btn uno-btn', pending));
        const picked = selectedDom != null ? privateHand[selectedDom] : null;
        if (picked) for (const end of ['left', 'right']) actions.append(button(end === 'left' ? '← Left end (' + room.ends[0] + ')' : 'Right end (' + room.ends[1] + ') →', () => { const index = selectedDom; selectedDom = null; call('move', { move: { type: 'play', index, end } }).catch(showError); }, 'uno-pick dm-end', pending || !domSides(picked)[end]));
      }
      if (gameKey === 'uno-style' && room.turn === studentId) {
        const label = room.drawPending ? `Draw ${room.drawPending} cards` : 'Draw a card';
        actions.append(button(label, () => call('move', { move: { type: room.drawPending ? 'draw-penalty' : 'draw' } }).catch(showError), 'btn uno-btn', pending));
        if (selectedUno != null) for (const color of ['red','yellow','green','blue']) actions.append(button(UNO_COLOR_NAMES[color], () => call('move', { move: { type: 'play', index: selectedUno, color } }).then(() => { selectedUno = null; }).catch(showError), 'uno-pick ' + color, pending));
      }
      if (gameKey === 'ludo' && room.turn === studentId) {
        if (room.lastRoll == null) actions.append(button('Roll die', () => call('move', { move: { type: 'roll' } }).catch(showError), 'btn uno-btn', pending));
        else actions.append(text('div', 'player-turn', 'Tap a glowing token.'));
      }
      actions.append(button('Leave game', leaveRoom, 'quiet', pending));
      actions.append(button('Browse other games', leaveRoom, 'quiet'));
    }
  }
  function runCountdown(countdownAt) {
    if (countdownTimer) return;
    const overlay = el('countdown'); overlay.hidden = false;
    const tick = () => {
      const remaining = Number(countdownAt) - Date.now();
      overlay.textContent = remaining > 0 ? String(Math.min(3, Math.ceil(remaining / 1000))) : 'Go!';
      if (remaining <= 0 && !countdownStarting) {
        countdownStarting = true; clearInterval(countdownTimer); countdownTimer = null;
        overlay.textContent = 'Starting…';
        call('countdown-start').catch(error => {
          countdownStarting = false;
          if (room?.state === 'countdown') {
            // The two devices can have slightly different clocks. The server is
            // authoritative, so retry instead of leaving an early caller stuck.
            overlay.textContent = 'Starting…';
            countdownRetryTimer = setTimeout(() => { countdownRetryTimer = null; runCountdown(countdownAt); }, 350);
          } else showError(error);
        });
      }
    };
    tick(); countdownTimer = setInterval(tick, 100);
  }
  function settleFinishedRoom() {
    if (!room || room.state !== 'finished' || settledRoomCode === roomCode || settlementInFlight === roomCode) return;
    settlementInFlight = roomCode;
    call('settle').then(() => {
      settledRoomCode = roomCode; settlementInFlight = ''; settlementRetries = 0;
      clearTimeout(settlementRetryTimer); settlementRetryTimer = null;
    }).catch(() => {
      settlementInFlight = '';
      settlementRetries += 1;
      if (settlementRetries <= 5 && room?.state === 'finished') {
        settlementRetryTimer = setTimeout(() => { settlementRetryTimer = null; settleFinishedRoom(); }, 1500);
      } else notice('Your game is finished, but the coin score is still saving. Refresh this game to try again.', true);
    });
  }
  const COMPUTER_WAIT_MS = 30000;
  async function quickPlay() {
    const supportsComputer = game?.computerOpponent === true;
    let searchCancelled = false;
    const cancelSearch = async () => {
      searchCancelled = true;
      try {
        const response = await callable({ action: 'cancel-quick-play', gameKey, workspaceId: classInfo.workspaceId, classId: classInfo.classId });
        const result = response.data || {};
        if (result.roomCode) {
          const url = new URL(location.href); url.searchParams.set('b3MultiplayerRoom', result.roomCode); url.searchParams.set('b3Multiplayer', 'join');
          location.assign(url.href); return;
        }
      } catch (error) { showError(error); return; }
      location.assign('index.html');
    };
    actions.replaceChildren(button('Cancel search', cancelSearch, 'quiet'));
    notice('Looking for a classmate…');
    try {
      const result = await call('quick-play');
      if (result.roomCode) {
        const url = new URL(location.href); url.searchParams.set('b3MultiplayerRoom', result.roomCode); url.searchParams.set('b3Multiplayer', 'join');
        location.assign(url.href); return;
      }
      // Wait for a classmate; computer-capable games fall back to the computer after COMPUTER_WAIT_MS or when the student asks.
      const deadline = Date.now() + (supportsComputer ? COMPUTER_WAIT_MS : Number.POSITIVE_INFINITY);
      let playNow = false;
      // Poll without call(): call() redraws the actions area, which would remove the buttons below on every check.
      const pollQuickPlay = () => callable({ action: 'quick-play', gameKey, workspaceId: classInfo.workspaceId, classId: classInfo.classId }).then(response => response.data || {});
      const showWait = () => notice(supportsComputer
        ? 'Looking for a classmate… ' + Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + ' seconds left, then you play the computer.'
        : 'Looking for a classmate. This game needs another student to play.');
      actions.replaceChildren(...(supportsComputer ? [button('Play the computer now', () => { playNow = true; }, 'btn')] : []), button('Cancel search', cancelSearch, 'quiet'));
      showWait();
      let lastPoll = Date.now();
      while (Date.now() < deadline && !playNow && !room) {
        if (searchCancelled) return;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (searchCancelled) return;
        showWait();
        if (playNow || Date.now() - lastPoll < 1000) continue;
        lastPoll = Date.now();
        const poll = await pollQuickPlay();
        if (poll.roomCode) {
          const url = new URL(location.href); url.searchParams.set('b3MultiplayerRoom', poll.roomCode); url.searchParams.set('b3Multiplayer', 'join');
          location.assign(url.href); return;
        }
      }
      if (!room && !searchCancelled && supportsComputer) {
        try {
          actions.replaceChildren(); notice('Starting a game against the computer…');
          const cancelled = await call('cancel-quick-play');
          if (cancelled.roomCode) {
            const url = new URL(location.href); url.searchParams.set('b3MultiplayerRoom', cancelled.roomCode); url.searchParams.set('b3Multiplayer', 'join');
            location.assign(url.href); return;
          }
          const fallback = await call('create', { computerOpponent: true });
          const url = new URL(location.href); url.searchParams.set('b3MultiplayerRoom', fallback.roomCode); url.searchParams.set('b3Multiplayer', 'host'); url.searchParams.set('b3ComputerOpponent', '1'); location.assign(url.href);
        } catch (error) { showError(error); }
      }
    } catch (error) { showError(error); }
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
      drawCheckersTable(board);
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
    } else if (gameKey === 'chess' || gameKey === 'chess-5min') {
      drawChessTable(board);
    } else if (gameKey === 'ludo') {
      drawLudoTable(board);
    } else if (gameKey === 'dominoes') {
      drawDominoTable(board);
    } else if (gameKey === 'go-fish') {
      drawGoFishTable(board);
    } else if (gameKey === 'uno-style') {
      drawUnoTable(board);
    }
  }
  const UNO_SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
  const UNO_COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
  function unoCardFace(card, extraClass) {
    const symbol = UNO_SYMBOLS[card.kind] || String(card.value);
    const isWild = card.kind === 'wild' || card.kind === 'wild4';
    const node = text('div', 'ucard ' + (isWild ? 'wild' : (card.color || 'wild')) + (extraClass ? ' ' + extraClass : ''));
    const face = text('div', 'face');
    if (!isWild) face.appendChild(text('span', 'c1', symbol));
    face.appendChild(text('div', 'oval'));
    face.appendChild(text('div', 'big' + (symbol.length > 1 || UNO_SYMBOLS[card.kind] ? ' sym' : ''), symbol));
    if (!isWild) face.appendChild(text('span', 'c2', symbol));
    node.appendChild(face);
    return node;
  }
  function unoCardName(card) {
    const names = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw two', wild: 'Wild', wild4: 'Wild draw four' };
    return (card.color ? (UNO_COLOR_NAMES[card.color] || card.color) + ' ' : '') + (names[card.kind] || card.value);
  }
  function drawUnoTable(board) {
    const ownTurn = room.turn === studentId && !room.finished, top = room.topCard;
    const bar = text('div', 'uno-bar');
    bar.append(text('span', 'uno-room', 'Room ' + roomCode));
    const ring = text('span', 'uno-color ' + (room.color || ''));
    ring.dataset.color = room.color || ''; if (top) ring.dataset.top = String(top.value);
    ring.append(text('b', ''), document.createTextNode('Color: ' + (UNO_COLOR_NAMES[room.color] || '—')));
    bar.appendChild(ring);
    const players = text('div', 'uno-players');
    (room.players || []).forEach(player => {
      const mine = player.studentId === studentId, turn = player.studentId === room.turn && !room.finished;
      const badge = text('div', 'uno-p' + (turn ? ' turn' : ''));
      const label = text('div', '', player.name + (mine ? ' (you)' : ''));
      const count = room.handCounts?.[player.studentId] || 0;
      label.appendChild(text('small', '', count + (count === 1 ? ' card' : ' cards') + (turn ? (mine ? ' · your turn!' : ' · playing') : '')));
      badge.append(text('i', '', String(player.name || '?').slice(0, 2)), label);
      players.appendChild(badge);
    });
    const mid = text('div', 'uno-mid');
    const drawPile = text('div', 'pile'), back = text('div', 'ucard back'), backFace = text('div', 'face');
    backFace.append(text('div', 'oval'), text('div', 'big', '★')); back.appendChild(backFace);
    drawPile.append(back, text('div', 'lbl', 'Draw pile'));
    const discard = text('div', 'pile');
    discard.append(top ? unoCardFace(top, 'disc') : text('div', 'ucard back'), text('div', 'lbl', 'Top card'));
    mid.append(drawPile, discard);
    const msg = text('div', 'uno-msg', room.drawPending && ownTurn ? 'Draw ' + room.drawPending + ' cards before your turn.' : '');
    if (ownTurn && !room.drawPending) msg.appendChild(text('small', '', 'Glowing cards can be played.'));
    const hand = text('div', 'uno-hand');
    privateHand.forEach((card, index) => {
      const isWild = card.kind === 'wild' || card.kind === 'wild4';
      const playable = ownTurn && !room.drawPending && (isWild || card.color === room.color || (top && card.value === top.value));
      const node = button('', () => {
        if (!ownTurn) return;
        if (isWild) { selectedUno = index; drawActions(); draw(); return; }
        call('move', { move: { type: 'play', index } }).catch(showError);
      }, 'ucard-button', pending || !ownTurn || !!room.drawPending);
      node.setAttribute('aria-label', unoCardName(card));
      node.dataset.color = card.color || 'wild'; node.dataset.value = String(card.value);
      const face = unoCardFace(card, (playable ? 'ok' : 'no') + (selectedUno === index ? ' picked' : ''));
      face.setAttribute('aria-hidden', 'true');
      node.appendChild(face);
      hand.appendChild(node);
    });
    board.append(bar, players, mid, msg, hand);
  }
  const LUDO_COLORS = ['red', 'yellow', 'green', 'blue'], LUDO_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
  const LUDO_SAFE = [8, 21, 34, 47];
  const LUDO_RING = (() => {
    const ring = [], add = (c, r) => ring.push([c, r]);
    for (let c = 1; c <= 5; c += 1) add(c, 6);
    for (let r = 5; r >= 0; r -= 1) add(6, r);
    add(7, 0); add(8, 0);
    for (let r = 1; r <= 5; r += 1) add(8, r);
    for (let c = 9; c <= 14; c += 1) add(c, 6);
    add(14, 7); add(14, 8);
    for (let c = 13; c >= 9; c -= 1) add(c, 8);
    for (let r = 9; r <= 14; r += 1) add(8, r);
    add(7, 14); add(6, 14);
    for (let r = 13; r >= 9; r -= 1) add(6, r);
    for (let c = 5; c >= 0; c -= 1) add(c, 8);
    add(0, 7); add(0, 6);
    return ring;
  })();
  const LUDO_LANE = { red: i => [1 + i, 7], yellow: i => [7, 1 + i], green: i => [13 - i, 7], blue: i => [7, 13 - i] };
  function ludoPosition(color, index, position) {
    return position < 51 ? LUDO_RING[(index * 13 + position) % 52] : LUDO_LANE[color](position - 51);
  }
  function ludoCanMove(position, roll) { return position < 0 ? roll === 6 : position + roll <= 57; }
  function drawLudoTable(board) {
    const ids = (room.playersOrder && room.playersOrder.length ? room.playersOrder : (room.players || []).map(player => player.studentId));
    const colorOf = id => LUDO_COLORS[Math.max(0, ids.indexOf(id)) % 4];
    const ownTurn = room.turn === studentId && !room.finished, rolled = room.lastRoll;
    const nameOf = id => (room.players || []).find(player => player.studentId === id)?.name || 'Player';
    const bar = text('div', 'ludo-players');
    ids.forEach(id => {
      const tokens = room.tokens?.[id] || [-1, -1, -1, -1], color = colorOf(id), turn = id === room.turn && !room.finished;
      const done = tokens.filter(position => position === 57).length, yard = tokens.filter(position => position < 0).length;
      const badge = text('div', 'lt-p ' + color + (turn ? ' turn' : ''));
      const dot = text('i', ''), label = text('div', '', nameOf(id) + (id === studentId ? ' (you)' : ''));
      label.appendChild(text('small', '', done + ' home · ' + yard + ' in the yard' + (turn ? (id === studentId ? ' · your turn!' : ' · playing') : '')));
      badge.append(dot, label); bar.appendChild(badge);
    });
    const grid = text('div', 'lboard'), cellAt = {};
    const place = (c, r, cls) => { const node = text('div', 'lc ' + (cls || '')); node.style.gridColumn = String(c + 1); node.style.gridRow = String(r + 1); grid.appendChild(node); cellAt[c + ',' + r] = node; return node; };
    const slots = {};
    [['red', 0, 0], ['yellow', 9, 0], ['blue', 0, 9], ['green', 9, 9]].forEach(([color, c, r]) => {
      const yard = text('div', 'yard ' + color); yard.style.gridColumn = (c + 1) + ' / span 6'; yard.style.gridRow = (r + 1) + ' / span 6';
      const pad = text('div', 'pad'); slots[color] = [];
      for (let i = 0; i < 4; i += 1) { const slot = text('div', 'slot'); slots[color].push(slot); pad.appendChild(slot); }
      yard.appendChild(pad); grid.appendChild(yard);
    });
    LUDO_RING.forEach(([c, r], i) => place(c, r, (i % 13 === 0 ? 'st-' + LUDO_COLORS[i / 13] : '') + (LUDO_SAFE.includes(i) ? ' safe' : '')));
    LUDO_COLORS.forEach(color => { for (let i = 0; i < 6; i += 1) { const [c, r] = LUDO_LANE[color](i); place(c, r, 't-' + color); } });
    const center = text('div', 'lcenter'); center.style.gridColumn = '7 / span 3'; center.style.gridRow = '7 / span 3'; grid.appendChild(center);
    ids.forEach(id => {
      const color = colorOf(id), index = ids.indexOf(id) % 4;
      (room.tokens?.[id] || [-1, -1, -1, -1]).forEach((position, tokenIndex) => {
        const mine = id === studentId, movable = mine && ownTurn && rolled != null && ludoCanMove(position, rolled);
        const where = position < 0 ? 'in the yard' : position >= 57 ? 'home' : position >= 51 ? 'in the home lane' : 'on the track';
        const pawn = button(String(tokenIndex + 1), () => { if (movable) call('move', { move: { type: 'token', token: tokenIndex } }).catch(showError); },
          'pawn ' + color + (movable ? ' go' : ''), pending || !movable);
        pawn.setAttribute('aria-label', nameOf(id) + ' token ' + (tokenIndex + 1) + ': ' + where);
        pawn.dataset.token = String(tokenIndex);
        if (position < 0) slots[color][tokenIndex].appendChild(pawn);
        else if (position >= 57) { pawn.classList.add('finished'); center.appendChild(pawn); }
        else { const [c, r] = ludoPosition(color, index, position); cellAt[c + ',' + r].appendChild(pawn); }
      });
    });
    const roll = text('div', 'lt-roll');
    if (rolled != null) {
      const die = text('div', 'die'); die.setAttribute('aria-hidden', 'true');
      const dots = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[rolled] || [];
      for (let i = 0; i < 9; i += 1) { const dot = text('b', ''); if (!dots.includes(i)) dot.style.visibility = 'hidden'; die.appendChild(dot); }
      roll.append(die, text('div', 'lt-hint', (nameOf(room.turn) + ' rolled a ' + rolled)));
    }
    board.append(bar, grid, roll);
  }
  let selectedDom = null;
  const DOM_PIPS = { 0: [], 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function domHalf(value) {
    const half = text('div', 'h'), pips = text('div', 'pips');
    for (let i = 0; i < 9; i += 1) pips.appendChild(text('b', DOM_PIPS[value]?.includes(i) ? '' : 'off'));
    half.appendChild(pips); return half;
  }
  function domTile(left, right, className) {
    const node = text('div', 'dt ' + (className || '') + (left === right ? ' dbl' : ''));
    node.append(domHalf(left), text('div', 'sep'), domHalf(right));
    return node;
  }
  function domChain(layout) {
    const lefts = [], rights = [];
    let first = null;
    layout.forEach((tile, index) => {
      if (index === 0 && !tile.end) { first = [tile.a, tile.b]; return; }
      if (tile.end === 'left') lefts.unshift(tile.flipped ? [tile.a, tile.b] : [tile.b, tile.a]);
      else rights.push(tile.flipped ? [tile.b, tile.a] : [tile.a, tile.b]);
    });
    return [...lefts, ...(first ? [first] : []), ...rights];
  }
  function domSides(tile) {
    const ends = room.ends || [];
    return { left: ends.length === 2 && (tile.a === ends[0] || tile.b === ends[0]), right: ends.length === 2 && (tile.a === ends[1] || tile.b === ends[1]) };
  }
  function drawDominoTable(board) {
    const ownTurn = room.turn === studentId && !room.finished;
    if (!ownTurn) selectedDom = null;
    const players = text('div', 'dm-players');
    (room.players || []).forEach(player => {
      const turn = player.studentId === room.turn && !room.finished, mine = player.studentId === studentId;
      const count = room.handCounts?.[player.studentId] || 0;
      const badge = text('div', 'dm-p' + (turn ? ' turn' : ''));
      const label = text('div', '', player.name + (mine ? ' (you)' : ''));
      label.appendChild(text('small', '', count + (count === 1 ? ' tile' : ' tiles') + (turn ? (mine ? ' · your turn!' : ' · playing') : '')));
      badge.append(text('i', '', String(player.name || '?').slice(0, 2)), label); players.appendChild(badge);
    });
    const felt = text('div', 'felt'), chain = text('div', 'dchain');
    const tiles = domChain(room.layout || []);
    tiles.forEach(([left, right], index) => {
      const open = index === 0 || index === tiles.length - 1;
      const node = domTile(left, right, open && tiles.length > 1 ? 'open' : '');
      node.dataset.a = String(left); node.dataset.b = String(right);
      chain.appendChild(node);
    });
    felt.appendChild(chain);
    const pile = text('div', 'dpile');
    pile.append(text('div', 'dback', '★'), text('div', '', 'Draw pile: ' + (room.boneyardCount || 0) + ' tiles'));
    const hand = text('div', 'dhand');
    privateHand.forEach((tile, index) => {
      const sides = domSides(tile), playable = ownTurn && (sides.left || sides.right);
      const node = button('', () => {
        if (!playable) return;
        if (sides.left && sides.right) { selectedDom = index; draw(); return; }
        selectedDom = null;
        call('move', { move: { type: 'play', index, end: sides.left ? 'left' : 'right' } }).catch(showError);
      }, 'dtile-button', pending || !playable);
      node.setAttribute('aria-label', 'Tile ' + tile.a + ' and ' + tile.b + (playable ? '' : ', cannot be played now'));
      node.dataset.a = String(tile.a); node.dataset.b = String(tile.b);
      node.appendChild(domTile(tile.a, tile.b, 'v ' + (playable ? 'go' : 'no') + (selectedDom === index ? ' picked' : '')));
      hand.appendChild(node);
    });
    const hint = text('div', 'dm-hint', ownTurn ? (selectedDom != null ? 'Choose which end to play on.' : 'Glowing tiles can be played.') : '');
    board.append(players, felt, pile, hand, hint);
  }
  const FISH_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const FISH_SUITS = [['o', '#ffba2c', '#d97a0f'], ['b', '#328ddd', '#2368ad'], ['g', '#3fc47e', '#1a7f4b'], ['p', '#a063d6', '#7434ad']];
  function fishSvg(fill, stroke) {
    const holder = text('span', 'fish');
    holder.innerHTML = '<svg viewBox="0 0 70 50" aria-hidden="true"><path d="M12 25Q27 3 46 25Q27 47 12 25L2 14v22z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/><circle cx="38" cy="22" r="3" fill="#14263e"/><path d="M20 26q8 5 14 0" fill="none" stroke="' + stroke + '" stroke-width="2"/></svg>';
    return holder;
  }
  function drawGoFishTable(board) {
    const ownTurn = room.turn === studentId && !room.finished;
    const groups = new Map();
    privateHand.forEach(card => { const group = groups.get(card.rank) || { count: 0, suit: card.suit || 0 }; group.count += 1; groups.set(card.rank, group); });
    if (askRank != null && (!ownTurn || !groups.has(askRank))) askRank = null;
    const players = text('div', 'gf-players');
    (room.players || []).forEach(player => {
      const mine = player.studentId === studentId, turn = player.studentId === room.turn && !room.finished;
      const cards = room.handCounts?.[player.studentId] || 0, books = room.bookCounts?.[player.studentId] || 0;
      const askable = !mine && ownTurn && askRank != null && cards > 0;
      const label = text('div', '', (askable ? 'Ask ' : '') + player.name + (mine ? ' (you)' : ''));
      label.appendChild(text('small', '', cards + (cards === 1 ? ' card' : ' cards') + ' · ' + books + (books === 1 ? ' book' : ' books')));
      const badge = askable
        ? button('', () => call('move', { move: { type: 'ask', rank: askRank, target: player.studentId } }).then(() => { askRank = null; }).catch(showError), 'gf-p ask', pending)
        : text('div', 'gf-p' + (turn ? ' turn' : ''));
      badge.append(text('i', '', String(player.name || '?').slice(0, 2)), label);
      players.appendChild(badge);
    });
    const pond = text('div', 'gf-pond');
    const books = text('div', 'gf-books'); books.appendChild(text('span', '', 'Books collected: ' + (room.bookCounts?.[studentId] || 0)));
    const water = text('div', 'water'); water.append(text('b', '', 'Pond'), text('b', '', (room.deckCount || 0) + ' cards'));
    pond.append(books, water);
    const hand = text('div', 'gf-hand');
    [...groups.entries()].forEach(([rank, group]) => {
      const [tone, fill, stroke] = FISH_SUITS[group.suit % 4];
      const node = button('', () => { askRank = askRank === rank ? null : rank; draw(); }, 'gcard-button', !ownTurn || pending);
      node.setAttribute('aria-label', FISH_RANKS[rank] + (group.count > 1 ? ', ' + group.count + ' cards' : ''));
      node.dataset.rank = String(rank);
      const card = text('div', 'fc ' + tone + (askRank === rank ? ' sel' : ownTurn ? ' can' : ''));
      const face = text('div', 'face');
      face.append(text('span', 'r', FISH_RANKS[rank]), fishSvg(fill, stroke), text('span', 'r2', FISH_RANKS[rank]));
      card.appendChild(face);
      if (group.count > 1) card.appendChild(text('span', 'n', '×' + group.count));
      node.appendChild(card); hand.appendChild(node);
    });
    const hint = text('div', 'gf-hint', ownTurn ? (askRank != null ? 'Asking for ' + FISH_RANKS[askRank] + 's — tap a player.' : 'Pick a card to ask for.') : '');
    board.append(players, pond, hand, hint);
  }
  function drawCheckersTable(board) {
    const ownTurn = room.turn === studentId && !room.finished;
    const redId = room.playersOrder?.[0];
    const mySide = redId === studentId ? 'red' : 'yellow';
    const pieces = room.board || Array(64).fill(null);
    if (selectedChecker != null && (!ownTurn || !String(pieces[selectedChecker] || '').startsWith(mySide))) selectedChecker = null;
    const counts = { red: 0, yellow: 0 };
    pieces.forEach(piece => { if (piece) counts[String(piece).startsWith('red') ? 'red' : 'yellow'] += 1; });
    const players = text('div', 'ck-players');
    (room.players || []).forEach(player => {
      const side = player.studentId === redId ? 'red' : 'yellow';
      const badge = text('div', 'ck-p' + (player.studentId === room.turn && !room.finished ? ' turn' : ''));
      const label = text('div', '', player.name + (player.studentId === studentId ? ' (you)' : ''));
      label.appendChild(text('small', '', (side === 'red' ? 'Red' : 'Dark') + ' · ' + counts[side] + (counts[side] === 1 ? ' piece' : ' pieces')));
      badge.append(text('i', side === 'red' ? 'r' : 'd'), label);
      players.appendChild(badge);
    });
    const grid = text('div', 'ck-board');
    for (let index = 0; index < 64; index += 1) {
      const piece = pieces[index] || '';
      const darkSquare = (Math.floor(index / 8) + index % 8) % 2 === 1;
      const own = !!piece && piece.startsWith(mySide);
      const target = ownTurn && selectedChecker != null && !piece && darkSquare;
      const node = button('', () => {
        if (own) { selectedChecker = selectedChecker === index ? null : index; draw(); return; }
        if (selectedChecker != null) { const from = selectedChecker; selectedChecker = null; call('move', { move: { type: 'move', from, to: index } }).catch(showError); }
      }, 'board-cell ck-sq ' + (darkSquare ? 'd' : 'l') + (target ? ' tgt' : ''), pending || !ownTurn || (!own && selectedChecker == null));
      node.setAttribute('aria-label', piece ? (piece.startsWith('red') ? 'Red ' : 'Dark ') + (piece.endsWith('-king') ? 'king' : 'piece') + (selectedChecker === index ? ', selected' : '') : 'Empty square');
      if (piece) {
        const disc = text('span', 'pc ' + (piece.startsWith('red') ? 'r' : 'y') + (selectedChecker === index ? ' sel' : own && ownTurn ? ' go' : ''));
        if (piece.endsWith('-king')) disc.appendChild(text('b', '', '♛'));
        node.appendChild(disc);
      }
      grid.appendChild(node);
    }
    const hint = text('div', 'ck-hint', ownTurn ? (selectedChecker != null ? 'Tap a gold spot to move there.' : 'Tap one of your glowing pieces.') : '');
    board.append(players, grid, hint);
  }
    // ---- Chess ----
  const CHESS_NAMES = { Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };
  let selectedChess = null, promotionPending = null, chessClockTimer = null, chessTimeoutAt = 0;
  function chessMyColor() { return room?.playersOrder?.[1] === studentId ? 'b' : 'w'; }
  function chessName(id) { return (room?.players || []).find(player => player.studentId === id)?.name || 'A classmate'; }
  function chessClockText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function chessResultText() {
    const [whiteId, blackId] = room.playersOrder || [];
    const score = id => room.points?.[id] || 0;
    if (room.endReason === 'time') {
      const line = score(whiteId) + ' to ' + score(blackId);
      if (room.draw) return 'Time is up! Equal points (' + score(whiteId) + ' each). It is a draw.';
      const winnerPoints = score(room.winner), loserPoints = score(room.winner === whiteId ? blackId : whiteId);
      return 'Time is up! ' + (room.winner === studentId ? 'You win' : chessName(room.winner) + ' wins') + ' with more points: ' + winnerPoints + ' to ' + loserPoints + '.';
    }
    if (room.endReason === 'checkmate') return 'Checkmate! ' + (room.winner === studentId ? 'You win!' : chessName(room.winner) + ' wins.');
    if (room.endReason === 'stalemate') return 'Stalemate. The player to move has no legal move, so it is a draw.';
    if (room.endReason === 'insufficient') return 'Draw. Neither player has enough pieces left to checkmate.';
    if (room.endReason === 'fifty-move') return 'Draw. Fifty moves passed with no capture or pawn move.';
    return room.draw ? 'It is a draw!' : (room.winner === studentId ? 'You win!' : chessName(room.winner) + ' wins.');
  }
  function chessStatusText() {
    if (room.finished || room.state === 'finished') return chessResultText();
    const mine = room.turn === studentId;
    const who = mine ? 'Your turn!' : chessName(room.turn) + ' is thinking.';
    return who + (room.check ? (mine ? ' Check! Protect your king.' : ' Check!') : '');
  }
  function chessSend(from, to, promotion) {
    selectedChess = null; promotionPending = null;
    return call('move', { move: Object.assign({ type: 'move', from, to }, promotion ? { promotion } : {}) }).catch(showError);
  }
  function chessTick() {
    const clock = document.getElementById('chessClock');
    if (!room || !clock || !room.endsAt) return;
    const left = room.endsAt - Date.now();
    clock.textContent = '⏱ ' + chessClockText(left);
    clock.classList.toggle('low', left <= 30000 && left > 0);
    if (left <= 0 && !room.finished && room.state === 'playing' && Date.now() - chessTimeoutAt > 2000) {
      chessTimeoutAt = Date.now();
      clock.textContent = '⏱ 0:00';
      callable({ action: 'move', gameKey, workspaceId: classInfo.workspaceId, classId: classInfo.classId, roomCode, move: { type: 'timeout' } }).catch(() => {});
    }
  }
  function drawChessTable(board) {
    const art = window.FTT_GAME_ART;
    const ownTurn = room.turn === studentId && !room.finished;
    const mine = chessMyColor(), pieces = room.board || [], legal = room.legal || {};
    if (selectedChess != null && (!ownTurn || !legal['s' + selectedChess])) selectedChess = null;
    const checkedKing = room.check ? (room.turn === room.playersOrder?.[0] ? 'wK' : 'bK') : '';
    const targets = new Set(selectedChess != null ? (legal['s' + selectedChess] || []) : []);
    if (room.endsAt && !room.finished) {
      const clock = text('b', '', ''); clock.id = 'chessClock';
      const strip = text('div', 'ch-timer');
      strip.append(clock, text('span', '', '5-minute game · most captured points wins at time'));
      board.appendChild(strip);
    }
    const bar = text('div', 'ch-players');
    (room.playersOrder || []).forEach((id, index) => {
      const color = index === 0 ? 'w' : 'b';
      const badge = text('div', 'ch-p' + (room.turn === id && !room.finished ? ' turn' : ''));
      const icon = text('span', 'ch-icon'); icon.appendChild(art.chessPiece('K', color));
      const label = text('div', '', chessName(id) + (id === studentId ? ' (you)' : '') + ' · ' + (color === 'w' ? 'White' : 'Dark'));
      const small = text('small', '', 'Points: ' + (room.points?.[id] || 0) + ' ');
      const captured = text('span', 'ch-cap');
      (room.captured?.[color] || []).slice().sort((a, b) => 'PNBRQ'.indexOf(a) - 'PNBRQ'.indexOf(b)).forEach(type => captured.appendChild(art.chessPiece(type, color === 'w' ? 'b' : 'w')));
      small.appendChild(captured); label.appendChild(small);
      badge.append(icon, label); bar.appendChild(badge);
    });
    board.appendChild(bar);
    const grid = text('div', 'ch-board');
    for (let displayIndex = 0; displayIndex < 64; displayIndex += 1) {
      const index = mine === 'w' ? displayIndex : 63 - displayIndex;
      const piece = pieces[index] || '', row = index >> 3, col = index & 7;
      const own = !!piece && piece[0] === mine, movable = own && ownTurn && !!legal['s' + index];
      const isTarget = targets.has(index);
      const classes = 'board-cell ch-sq ' + ((row + col) % 2 ? 'd' : 'l') + (room.lastMove && (room.lastMove.from === index || room.lastMove.to === index) ? ' last' : '')
        + (checkedKing && piece === checkedKing ? ' chk' : '') + (isTarget ? ' tgt' + (piece ? ' cap' : '') : '') + (selectedChess === index ? ' sel' : '');
      const node = button('', () => {
        if (promotionPending) return;
        if (movable) { selectedChess = selectedChess === index ? null : index; draw(); return; }
        if (isTarget && selectedChess != null) {
          const from = selectedChess, mover = pieces[from];
          if (mover && mover[1] === 'P' && (row === 0 || row === 7)) { promotionPending = { from, to: index }; draw(); return; }
          chessSend(from, index);
        }
      }, classes, pending || !ownTurn || (!movable && !isTarget));
      const file = 'abcdefgh'[col], rank = 8 - row;
      node.setAttribute('aria-label', (piece ? (piece[0] === 'w' ? 'White ' : 'Dark ') + { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[piece[1]] + ' on ' : 'Empty square ') + file + rank + (selectedChess === index ? ', selected' : '') + (isTarget ? ', you can move here' : ''));
      node.dataset.index = String(index);
      if (piece) node.appendChild(art.chessPiece(piece[1], piece[0]));
      grid.appendChild(node);
    }
    board.appendChild(grid);
    if (promotionPending) {
      const pick = text('div', 'ch-promo');
      pick.appendChild(text('b', '', 'Promote your pawn to:'));
      ['Q', 'R', 'B', 'N'].forEach(type => {
        const choice = button('', () => chessSend(promotionPending.from, promotionPending.to, type), 'ch-promo-btn', pending);
        choice.setAttribute('aria-label', CHESS_NAMES[type]);
        choice.append(art.chessPiece(type, mine), text('span', '', CHESS_NAMES[type]));
        pick.appendChild(choice);
      });
      pick.appendChild(button('Cancel', () => { promotionPending = null; draw(); }, 'quiet'));
      board.appendChild(pick);
    } else board.appendChild(text('div', 'ch-hint', ownTurn ? (selectedChess != null ? 'Tap a gold spot to move there.' : 'Tap one of your glowing pieces.') : ''));
    clearInterval(chessClockTimer); chessClockTimer = null;
    if (room.endsAt && !room.finished) { chessTick(); chessClockTimer = setInterval(chessTick, 500); }
  }
  function draw() {
    if (!room) return;
    el('room').classList.toggle('uno-mode', gameKey === 'uno-style');
    el('room').classList.toggle('ludo-mode', gameKey === 'ludo');
    el('room').classList.toggle('dominoes-mode', gameKey === 'dominoes');
    el('room').classList.toggle('gofish-mode', gameKey === 'go-fish');
    el('room').classList.toggle('checkers-mode', gameKey === 'checkers');
    el('room').classList.toggle('chess-mode', gameKey === 'chess' || gameKey === 'chess-5min');
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
    if (!window.firebase || !window.B3_FIREBASE_CONFIG || !game) {
      notice(game ? 'Sign in on Fun Torah Tools first. ' : 'Choose a game from the Multiplayer Center.', true);
      showBrowse(); return;
    }
    studentId = savedId;
    setTitle();
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
          classInfo = await window.B3MultiplayerIdentity.resolve(db, user, params.get('classId') || '', savedId);
          studentId = classInfo.participantId;
          setTitle();
          if (typeof firebase.functions !== 'function') throw new Error('The secure multiplayer service did not load. Reload the page to try again.');
          callable = firebase.app().functions('us-central1').httpsCallable('multiplayerGameAction');
          const code = params.get('b3MultiplayerRoom');
          if (code) {
            roomCode = code;
            const isSpectating = params.get('b3Multiplayer') === 'spectate';
            const result = await call(isSpectating ? 'spectate' : 'join');
            clearSavedRejoin(code);
            if (result.public?.state === 'closed') throw new Error('That room has closed.');
            const mode = isSpectating ? 'spectate' : (result.public?.host === studentId ? 'host' : 'join');
            params.set('b3Multiplayer', mode);
            history.replaceState(null, '', location.pathname + '?' + params.toString());
            listen(code); notice(isSpectating ? 'You are watching this match.' : 'Connected to your class game.');
          } else if (params.get('b3Multiplayer') === 'start' || !params.has('b3Multiplayer')) {
            if (params.get('b3Multiplayer') === 'start') {
              roomSection.hidden = false;
              quickPlay();
              return;
            }
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
