require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// 웹 서버 설정 (Render 24시간 가동 및 인증 콜백용)
const app = express();
const port = process.env.PORT || 3000;

// 디스코드 봇 클라이언트 설정 (채팅 읽기 인텐트 추가)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ==========================================
// 1. MongoDB 데이터베이스 연결
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB 연결 성공!'))
    .catch(err => console.error('❌ MongoDB 연결 실패:', err));

const UserSchema = new mongoose.Schema({
    userId: String,
    verifiedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// ==========================================
// 2. 봇 준비 완료 (Ready) 이벤트 & 서버 목록 출력
// ==========================================
client.once('ready', async () => {
    console.log(`=================================`);
    console.log(`🤖 봇 로그인 완료: ${client.user.tag}`);
    console.log(`📌 현재 봇이 참가 중인 서버 목록 (총 ${client.guilds.cache.size}개):`);
    client.guilds.cache.forEach(guild => {
        console.log(`- [ ${guild.name} ] | ID: ${guild.id} | 멤버: ${guild.memberCount}명`);
    });
    console.log(`=================================`);
});

// ==========================================
// 2-1. !인증메시지 명령어 처리 이벤트
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    if (message.content === '!인증메시지') {
        // 관리자 권한 체크 (선택사항)
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('이 명령어는 관리자만 사용할 수 있습니다.');
        }

        // 인증 링크 (identify와 guilds 스코프를 포함하여 사진처럼 서버 확인 권한을 요청함)
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setURL(authUrl)
                .setLabel('웹으로 인증하기')
        );

        await message.channel.send({
            content: '📌 **[ 킹인수 패밀리 인증 시스템 ]**\n아래 버튼을 눌러 웹 인증을 진행해 주세요!',
            components: [row]
        });
        
        // 사용자가 보낸 명령어 원본 삭제
        await message.delete().catch(() => {});
    }
});

// ==========================================
// 3. 웹 서버 라우팅 (디스코드 인증 콜백 처리)
// ==========================================
app.get('/', (req, res) => {
    res.send('봇이 24시간 정상적으로 가동 중입니다. 🚀');
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    try {
        // 1) 디스코드에서 Access Token 받아오기
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // 2) 유저의 디스코드 고유 ID 받아오기
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;
        const username = userResponse.data.username;

        // (참고) 필요 시 유저가 속한 서버 목록도 아래 API로 조회 가능합니다.
        // const userGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
        //     headers: { Authorization: `Bearer ${accessToken}` }
        // });

        // 3) 디스코드 서버(Guild) 및 멤버 객체 찾기
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return res.status(500).send('설정된 서버를 찾을 수 없습니다.');

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).send('서버에 접속해 있지 않습니다. 디스코드 서버에 먼저 입장해주세요!');

        // 4) 인증 완료 역할(Role) 부여하기
        const role = guild.roles.cache.get(process.env.VERIFIED_ROLE_ID);
        if (role) {
            await member.roles.add(role);
        }

        // 5) MongoDB 데이터베이스에 인증 기록 저장
        await User.findOneAndUpdate(
            { userId: userId }, 
            { userId: userId, verifiedAt: new Date() }, 
            { upsert: true, new: true }
        );

        // 6) 로그 채널에 인증 성공 메시지 전송
        const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send(`✅ **인증 완료**: <@${userId}> (${username}) 님이 웹 인증을 완료했습니다.`);
        }

        // 7) 유저에게 보여줄 성공 화면
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h1 style="color: #5865F2;">인증이 완료되었습니다! 🎉</h1>
                <p>이제 이 창을 닫고 디스코드로 돌아가셔도 됩니다.</p>
            </div>
        `);

    } catch (error) {
        console.error('인증 처리 중 오류 발생:', error);
        res.status(500).send('인증 과정에서 오류가 발생했습니다. 다시 시도해주세요.');
    }
});

// ==========================================
// 4. 서버 및 봇 실행
// ==========================================
app.listen(port, () => {
    console.log(`🌐 웹 서버가 포트 ${port}에서 실행 중입니다.`);
});

client.login(process.env.DISCORD_TOKEN);