const {GatewayIntentBits, Client, EmbedBuilder, ButtonBuilder, ActionRowBuilder, Events} = require("discord.js");
const ytdl = require("ytdl-core");
const config = require("./config.json");
const {joinVoiceChannel} = require('@discordjs/voice');
const {createAudioPlayer, createAudioResource, AudioPlayerStatus} = require('@discordjs/voice');

const player = createAudioPlayer();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
})
let songs = [];
let voiceConnection;
prefix = config.PREFIX;
let channel;
let playerMode = 'normal';
let lastIndexOnPage = 0;

const backId = 'back'
const forwardId = 'forward'
const backButton = new ButtonBuilder()
    .setStyle('Secondary')
    .setLabel('Назад')
    .setCustomId(backId);

const forwardButton =  new ButtonBuilder()
    .setStyle('Secondary')
    .setLabel('Вперёд')
    .setCustomId(forwardId);

player.on(AudioPlayerStatus.Idle, (prev, current) => {
    let previousSong = findLastPlayed('(Играет)');
    previousSong.status = '(Закончилась)'
    playNextSong();
});

client.on(Events.InteractionCreate, interaction => {
    if (!interaction.isButton()) return;
    let embed;
    if (interaction.customId === backId) {
        lastIndexOnPage = lastIndexOnPage - config.PLAYLIST_PAGE_SIZE;
        embed = generateEmbedPlayList(lastIndexOnPage,lastIndexOnPage + config.PLAYLIST_PAGE_SIZE);
    }
    if (interaction.customId === forwardId) {
        lastIndexOnPage = lastIndexOnPage + config.PLAYLIST_PAGE_SIZE;
        embed = generateEmbedPlayList(lastIndexOnPage,lastIndexOnPage + config.PLAYLIST_PAGE_SIZE);
    }
    interaction.update({ embeds: [embed],
        components: [new ActionRowBuilder().setComponents([backButton, forwardButton])
    ]});
});

client.once("ready", () => {
    console.log("Ready!");
    channel = client.channels.cache.get(config.BOT_TEXT_CHANNEL_ID)
});

client.once("reconnecting", () => {
    console.log("Reconnecting!");
});

client.once("disconnect", () => {
    console.log("Disconnect!");
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    if (message.content.startsWith(`${prefix}play `)) {
        execute(message);
        return null;
    }
    if (message.content.startsWith(`${prefix}skip`)) {
        let previousSong = findLastPlayed('(Играет)');
        previousSong.status = '(Закончилась)'
        playNextSong();
        return null;
    }
    if (message.content.startsWith(`${prefix}pause`)) {
        player.pause();
        return null;
    }
    if (message.content.startsWith(`${prefix}resume`)) {
        player.unpause();
        return null;
    }
    if (message.content.startsWith(`${prefix}stop`)) {
        voiceConnection.destroy();
        voiceConnection = '';
        return null;
    }
    if (message.content.startsWith(`${prefix}join`)) {
        voiceConnection = await joinVoiceChannel(
            {
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
        return null;
    }
    if (message.content.startsWith(`${prefix}repeat`)) {
        let currentSong = findLastPlayed('(Играет)')
        currentSong.status = '';
        repeat();
        return null;
    }
    if (message.content.startsWith(`${prefix}playlist`)) {
        let embed = generateEmbedPlayList();
        channel.send({
            embeds: [embed],
            components: [new ActionRowBuilder().setComponents([backButton, forwardButton])
            ]});
        return null;
    }
    if (message.content.startsWith(`${prefix}cyclic`)) {
        channel.send('При завершении плейлиста он будет начинаться заново')
        playerMode = 'cyclic'
        return null;
    }
    if (message.content.startsWith(`${prefix}normal`)) {
        channel.send('Плеер теперь в обычном режиме работы')
        playerMode = 'normal'
        return null;
    }
});

function playNextSong() {
    play(voiceConnection);
}

function generateEmbedPlayList(start, end) {
    console.log(start, end);
    let playListSongs = getPlayListSongs(start ?? 0, end ?? config.PLAYLIST_PAGE_SIZE);
    let embedMessage = new EmbedBuilder()
        .setTitle('Плейлист');
    playListSongs.forEach((song) => {
        embedMessage.addFields(
        { name: '\u200b', value: song.title + song.status, inline: false },
        )
    })
    return embedMessage;
}

function getPlayListSongs(start, end) {
    let songsPagination = [];
    for (let i= start; i < end; i++) {
        if (songs[i]) {
            songsPagination.push(songs[i]);
        }
    }
    return songsPagination;
}

async function execute(message) {
    const args = message.content.split(" ");
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel)
        return message.channel.send(
            "Для прослушивания музыки вы должны быть в голосовом канале"
        );
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send(
            "Мне нужны права для присоединения и использования микрофона в этом голосовом канале"
        );
    }
    if (args[1].includes('playlist?list=')) {
        let playlistId = args[1].substring(args[1].lastIndexOf('list=') + 5)
        let url = "https://www.googleapis.com/youtube/v3/playlistItems/?key="
            + config.YOUTUBE_KEY +
            "&playlistId="
            + playlistId +
            "&part=snippet&maxResults="
            + config.MAX_PLAYLIST_ITEMS
        let response = await fetch(url)
            .then(response => response.json())
        await insertSongInArray(response.items[0])
        response.items.shift();
        insertInSongsArray(response.items);
        if (response.nextPageToken) {
            getBigPlayList(url, response)
        }
    } else {
        const songInfo = await ytdl.getInfo(args[1]);
        const song = {
            title: songInfo.videoDetails.title,
            url: songInfo.videoDetails.video_url,
            status: '',
        };
        songs.push(song);
    }

    if (!voiceConnection) {
        voiceConnection = await joinVoiceChannel(
            {
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
    }
    if (player.state.status === 'idle') {
        play(voiceConnection)
    }
}

async function getBigPlayList(url, response) {
    do {
        console.log(response.nextPageToken)
        url += '&pageToken=' + response.nextPageToken;
        response = await fetch(url)
            .then(response => response.json())
        await insertInSongsArray(response.items);
    } while (response.nextPageToken)
}
async function insertInSongsArray(response) {
    for (let song of response) {
        await insertSongInArray(song)
    }
}

async function insertSongInArray(song) {
    await ytdl.getInfo(song.snippet.resourceId.videoId).then((songInfo) => {
        songs.push({
            title: songInfo.videoDetails.title,
            url: songInfo.videoDetails.video_url,
            status: '',
        });
    });
}

function findNextSong() {
    return songs.find( function (song) {
        return song.status === '';
    })
}

function findLastPlayed(status) {
    return songs.slice().reverse().find(function (song) {
        return song.status === status;
    })
}

function repeat() {
    let song = findLastPlayed('(Закончилась)');
    song.status = '';
    play(voiceConnection);
}

function play(guild) {
    if (songs.length !== 0) {
        let song = findNextSong();
        if (!song) {
            if (playerMode === 'cyclic') {
                songs.forEach(song => {
                    song.status = '';
                })
                play(voiceConnection);
                return 0;
            }
            channel.send('Плейлист закончился, добавьте песни через !play')
            voiceConnection.destroy();
            voiceConnection = '';
            return 0;
        }
        const stream = ytdl(song.url, {filter: 'audioonly', highWaterMark: 1 << 25});
        var resource = createAudioResource(stream);
        song.status = '(Играет)';
        channel.send('Сейчас играет ' + song.title)
        player.play(resource);
        guild.subscribe(player)
    }
}

client.login(config.BOT_TOKEN);