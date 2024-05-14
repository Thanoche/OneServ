const socketIo = require("socket.io");
const Player = require("../jeu/Player");
const Bot = require("../jeu/Bot");
const ManageGame = require("../jeu/ManageGame");
function setupSocket(server) {
  // Paramétrage socket.io pour le serveur hebergé en local
  const io = socketIo(server, {
    cors: {
      origin: [process.env.SERVER_CLIENT, "https://onegame-sepia.vercel.app"],
      methods: ["GET", "POST"],
    },
  });

  // Déclaration de plusieurs variables pour la gestion du jeu
  let roomId = 1;
  const rooms = {};
  const playerDetails = {};

  // Le serveur via socket.io, va écouter si un joueur se connecte et initialise les fonctions internes.
  io.on("connection", (socket) => {
    // Pour le débugage
    console.log(`Nouveau joueur connecté: ${socket.id}`);

    // Lorsque le serveur écoute qu'un joueur s'est connecté et qu'il est authentifié (en envoyant sur username),
    // va modifier les informations du joueurs pour retenir son username. Et envoyer que ce dernier est bien connecté.
    socket.on("authenticate", (username) => {
      if (username) {
        socket.user = { username: username, id: socket.id };
        console.log(socket.id, socket.user);
        // Pour la connexion avec le front et le back
        io.emit("authenticated", "Authentification reussie");
      }
    });

    // Permet à un joueur de créer une nouvelle room, en choisiant le nombre de joueurs maximum.
    socket.on("createRoom", ({ maxPlayers, bot }) => {
      const newRoom = {
        id: roomId,
        owner: socket.user,
        players: [socket.user],
        maxPlayers,
        gamestarted: false,
        game: null, // Initialise le jeu sans joueurs pour l'instant
        bot: bot,
      };

      rooms[roomId] = newRoom;
      console.log(socket.user);
      playerDetails[socket.id] = {
        roomId,
        player: new Player(socket.user.username),
      };

      // Permet au joueur de rejoindre une room
      socket.join(roomId);
      // Lui envoi l'informations de quelle room il a crée
      socket.emit("roomCreated", {
        roomId,
      });
      // augmente le compteur de roomId, pour avoir que des rooms différentes
      roomId += 1;
    });

    // Permet à un joueur d'envoyer un message au sein de sa room.
    socket.on("message", (newMsg) => {
      io.to(newMsg.room).emit("message", newMsg);
    });

    // Permet au joueur de se déconnecter
    socket.on("disconnect", () => {
      console.log(`Joueur ${socket.id} deconnecté`);
      const details = playerDetails[socket.id];
      if (details) {
        const { roomId } = details;
        const room = rooms[roomId];
        if (room) {
          room.players = room.players.filter(
            ({ username }) => username !== details.player.name
          );
          if (room.players.length === 0) {
            // Supprime la room si elle est vide
            delete rooms[roomId];
          } else {
            io.to(roomId).emit("playerDisconnected", {
              owner: room.owner,
              players: room.players,
            });
          }
        }
        delete playerDetails[socket.id];
      }
    });

    // Permet à un joueur de rejoindre une room précise, tant que cette dernière existe et non remplie.
    socket.on("joinRoom", ({ roomId }) => {
      const room = rooms[roomId];
      // verifie que la room existe dans la liste de liste crée.
      if (!room) {
        socket.emit("error", "Room not exists");
        return;
      }

      // verifie que la room n'est pas remplie
      if (room.players.length >= room.maxPlayers) {
        socket.emit("error", "Room is full");
        return;
      }

      if (room.gamestarted == true) {
        socket.emit("error", "Game already started");
        return;
      }

      // Ajoute le joueur à la liste des joueurs de la room
      room.players.push(socket.user);
      console.log("Liste des joueurs :", room.players);
      playerDetails[socket.id] = {
        roomId: parseInt(roomId),
        player: new Player(socket.user.username),
      };
      // rejoins la room
      socket.join(room.id);
      socket.emit("roomJoined");
      // rajouter dans le coté client qd joeur rejoint en updantant la liste des joueurs
      io.to(room.id).emit("playerJoined", {
        owner: room.owner,
        players: room.players,
      });
    });

    socket.on("startGame", ({ roomId }) => {
      console.log(socket.user.username);
      const room = rooms[roomId];

      // Vérifiez si l'utilisateur est le créateur de la room
      if (!room || room.owner.id !== socket.user.id) {
        socket.emit("error", "Seul le créateur peut démarrer le jeu");
        return;
      }

      // Vérifie si le nombre de joueurs est suffisant
      if (room.bot === false) {
        if (room.players.length < room.maxPlayers) {
          socket.emit("error", "Pas assez de joueurs");
          return;
        }
      } else {
        while (room.players.length < room.maxPlayers) {
          const botPlayer = new Bot();
          room.players.push({ username: botPlayer.name, id: "bot" + botPlayer.id });
          playerDetails["bot"+botPlayer.id] = { roomId: roomId, player: botPlayer };
          console.log("Room players ", room.players)
          console.log("Room playersdetail ", playerDetails)
        }
      }

      // Initialiser le jeu
      room.gamestarted = true;
      console.log("Room players ", room.players);
      const game = new ManageGame(
        room.players.map(({ id }) => playerDetails[id].player)
      );
      room.game = game;
      game.GameStart();

      io.to(room.id).emit("gameStarted");
    });

    socket.on("GameHasStarted", ({ roomId }) => {
      const room = rooms[roomId];
      if (room) {
        const start = room.players.map((player) => {
          const findplayer = room.game.players.find(
            (item) => item.name === player.username
          );
          if (findplayer.name === socket.user.username) {
            return {
              username: findplayer.name,
              id: player.id,
              hand: findplayer.hand,
            };
          } else {
            return {
              username: findplayer.name,
              id: player.id,
              hand: findplayer.hand.map((_) => null),
            };
          }
        });
        const currentColor =
          room.game.lastCard.color !== "allcolors" &&
          room.game.lastCard.color !== "withoutcolor"
            ? room.game.lastCard.color
            : room.game.lastColor;
        const currentTurn = room.game.currentPlayer.name;
        const playableCards =
          socket.user.username === currentTurn
            ? room.game.getPlayableCards()
            : null;
        console.log("Cartes jouables 203: ",playableCards);
        socket.emit("SendInfo", {
          players: start,
          lastCard: room.game.lastCard,
          currentColor: currentColor,
          currentTurn: currentTurn,
          playableCards: playableCards,
        });
      }
    });

    //un joueur pioche des cartes
    socket.on("drawCards", ({ roomId }) => {
      const room = rooms[roomId];
      if (room.game) {
        const current = room.game.currentPlayer.name;
        room.game.draw();
        const { hand } = room.game.players.filter(
          (player) => player.name === current
        )[0];
        room.players.forEach((player) => {
          io.to(player.id).emit("updateDraw", {
            hand: {
              player: current,
              newhand: hand.map((carte) => {
                if (player.username === current) {
                  return carte;
                } else {
                  return null;
                }
              }),
            },
            currentTurn: room.game.currentPlayer.name,
            playableCards:
              player.username === room.game.currentPlayer.name
                ? room.game.getPlayableCards()
                : null,
          });
        });
      }
      if (room.game.isBot()) {
        botPlay(room);
      }
    });

    socket.on("playCard", ({ cardPlayed, color }) => {
      // Identifier le joueur et la partie à partir des informations de la socket
      const player = playerDetails[socket.id];
      const room = rooms[playerDetails[socket.id].roomId];
      if (!player) {
        socket.emit("error", { message: "Joueur non trouvé." });
        return;
      }

      const { game } = room;
      if (!game) {
        socket.emit("error", { message: "Partie non trouvée." });
        return;
      }

      // Vérifier si c'est le tour du joueur
      if (game.currentPlayer.name !== socket.user.username) {
        socket.emit("error", { message: "Ce n'est pas votre tour." });
        return;
      }

      const playedCard = [];
      for (const cardIndex of cardPlayed) {
        playedCard.push(game.currentPlayer.hand[cardIndex]);
      }
      console.log("played Card: ",playedCard);

      const current = game.currentPlayer.name;
      game.play(playedCard, color);

      sendAfterPlay(room, current);
      
      if (room.game.isBot()) {
        botPlay(room);
      }

      if (room.game.end === true) {
        endGame(player.roomId);
      }
    });

    socket.on("One", (roomId) => {
      const room = rooms[roomId];
      if (room) {
        room.notOne = room.game.currentPlayer.previousPlayer;
        io.to(roomId).emit("OneOutPossible");
      }
      setTimeout(() => {
        room.notOne = null;
      }, 3000);
    });

    socket.on("OneOut", (roomId) => {
      const room = rooms[roomId];
      if (room && room.notOne) {
        room.game.notOne(room.notOne);
        io.to(roomId).emit("OneOutNotPossible");
        room.players.forEach((player) => {
          io.to(player.id).emit("updateOne", {
            name: room.notOne.name,
            hand: room.notOne.hand.map((carte) => {
              if (player.username === room.notOne.name) {
                return carte;
              } else {
                return null;
              }
            }),
            playableCards:
              player.username === room.game.currentPlayer.name
                ? room.game.getPlayableCards()
                : null,
          });
        });
        room.notOne = null;
      }
    });
  });

  function endGame(roomId) {
    const room = rooms[roomId];
    if (!room) {
      console.error(`La salle ${roomId} n'existe pas.`);
      return;
    }

    // Identifiez le gagnant (premier à n'avoir plus de cartes) et les autres joueurs pour le classement
    const rankings = room.players
      .map((playerId) => {
        const player = playerDetails[playerId.id];
        return {
          username: player.player.name,
          cardCount: player.player.hand.length,
        };
      })
      .sort((a, b) => a.cardCount - b.cardCount);

    const winner = rankings.find((player) => player.cardCount === 0);
    const results = {
      winner: winner ? winner.username : "Pas de gagnant",
      rankings,
    };

    // Envoie les résultats à tous les joueurs dans la salle
    io.to(roomId).emit("gameResults", results);
    console.log(
      `Classements envoyés pour la salle ${roomId}. Gagnant: ${results.winner}`
    );

    room.players.forEach((playerId) => {
      // Nettoie la salle et les détails des joueurs
      delete playerDetails[playerId];
    });
    delete rooms[roomId];
    console.log(`Salle ${roomId} supprimée après avoir affiché les résultats.`);
  }

  const sendAfterPlay = (room, current) => {
    const { hand } = room.game.players.filter(
      (player) => player.name === current
    )[0];
    const currentColor =
      room.game.lastCard.color !== "allColors" &&
      room.game.lastCard.color !== "withoutColor"
        ? room.game.lastCard.color
        : room.game.lastColor;
    room.players.forEach((player) => {
      const toSend = {
        player: current,
        newhand: hand.map((carte) => {
          if (player.username === current) {
            return carte;
          } else {
            return null;
          }
        }),
      };
      if (
        (room.game.lastCard.isPlus2Card() ||
          room.game.lastCard.isPlus4Card()) &&
        room.game.sumPinition === 0
      ) {
        const previousPlayerName = room.game.currentPlayer.previousPlayer.name;
        const previousPlayerHand = room.game.currentPlayer.previousPlayer.hand;
        toSend.previousPlayer = {
          name: previousPlayerName,
          hand: previousPlayerHand.map((carte) => {
            if (
              player.username === room.game.currentPlayer.previousPlayer.name
            ) {
              return carte;
            } else {
              return null;
            }
          }),
        };
      }
      console.log ("send ",{
        hand: toSend,
        lastCard: room.game.lastCard,
        currentColor: currentColor,
        currentTurn: room.game.currentPlayer.name,
        playableCards:
          player.username === room.game.currentPlayer.name
            ? room.game.getPlayableCards()
            : null,
      })
      console.log("playernov",player.id)
      io.to(player.id).emit("hasPlayed", {
        hand: toSend,
        lastCard: room.game.lastCard,
        currentColor: currentColor,
        currentTurn: room.game.currentPlayer.name,
        playableCards:
          player.username === room.game.currentPlayer.name
            ? room.game.getPlayableCards()
            : null,
      });
    });
  };

  const botPlay = (room) => {
    if (room.game.isBot() && room.game.end === false)  {
      const botCards = room.game.getPlayableCards();
      const analyze = room.game.analyzeCards(botCards);
  
      // Générer une couleur aléatoire
      const couleurs = ["violet", "rose", "bleu", "vert"];
      const indexAleatoire = Math.floor(Math.random() * couleurs.length);
  
      // Obtenir la couleur correspondante
      const botColor = couleurs[indexAleatoire];
      const currentBot = room.game.currentPlayer.name;
      room.game.decideAndPlay(botCards, analyze, botColor);
      setTimeout(() => {
        sendAfterPlay(room, currentBot);
        if (room.game.end === true) {
          endGame(room.id);
        }
        else if (room.game.isBot()) {
          botPlay(room);
      }
      }, 2000);
      
    }
  }
}


module.exports = { setupSocket };
