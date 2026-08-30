require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// 환경변수 불러오기
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// 웹 인증 서버 라우트 (OAuth2)
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    try {
        // OAuth2 토큰 요청
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            scope: 'identify guilds'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // 사용자 정보 요청
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const userId = userResponse.data.id;
        const username = userResponse.data.username;

        // 역할 지급 처리
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userId);

        if (member) {
            await member.roles.add(VERIFIED_ROLE_ID);

            // 로그 채널에 메시지 전송
            if (LOG_CHANNEL_ID) {
                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('✅ 인증 완료 로그')
                        .setDescription(`<@${userId}> (${username}) 님이 인증을 완료하고 역할이 지급되었습니다.`)
                        .setColor(0x00FF00)
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            res.send(`
                <html>
                    <head><title>인증 완료</title></head>
                    <body style="background-color: #2c2f33; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                        <div style="text-align: center; background: #23272a; padding: 40px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                            <h1 style="color: #57F287;">🎉 인증 성공!</h1>
                            <p>성공적으로 계정 인증이 완료되었습니다.</p>
                            <p>이 창을 닫고 디스코드 채널로 돌아가세요.</p>
                        </div>
                    </body>
                </html>
            `);
        } else {
            res.status(404).send('서버에서 해당 사용자를 찾을 수 없습니다.');
        }

    } catch (error) {
        console.error('❌ 인증 처리 중 오류 자세히보기:', error.response ? error.response.data : error.message);
        res.status(500).send('인증 과정에서 오류가 발생했습니다. 다시 시도해 주세요.');
    }
});

// 디스코드 봇 이벤트
client.once('ready', () => {
    console.log(`[봇 로그인 완료] ${client.user.tag} 계정으로 작동 중입니다.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!인증메시지') {
        // scope에 guilds 추가!
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

        const embed = new EmbedBuilder()
            .setTitle('킹인수 패밀리')
            .setDescription('다른 채널을 보려면 아래 버튼을 눌러 계정을 인증하세요.')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('인증하기')
                .setStyle(ButtonStyle.Link)
                .setURL(authUrl)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

// 웹 서버 및 봇 로그인
app.listen(3000, () => {
    console.log('[웹 서버 실행 중] http://localhost:3000');
});

client.login(DISCORD_TOKEN);