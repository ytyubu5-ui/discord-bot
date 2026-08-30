require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;

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
// 2-0. 신규 유저 입장 시 '미인증' 역할 자동 부여
// ==========================================
client.on('guildMemberAdd', async member => {
    try {
        if (member.guild.id !== process.env.GUILD_ID) return;

        const unverifiedRoleId = process.env.UNVERIFIED_ROLE_ID; 
        if (unverifiedRoleId) {
            const role = member.guild.roles.cache.get(unverifiedRoleId);
            if (role) {
                await member.roles.add(role);
                console.log(`📥 신규 유저 입장: ${member.user.tag}에게 '미인증' 역할 부여 완료`);
            }
        }
    } catch (error) {
        console.error('신규 유저 역할 부여 중 오류 발생:', error);
    }
});

// ==========================================
// 2-1. 명령어 처리 이벤트 (!인증메시지 & !급식)
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // 1) !인증메시지 명령어
    if (message.content === '!인증메시지') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('이 명령어는 관리자만 사용할 수 있습니다.');
        }

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
        
        await message.delete().catch(() => {});
    }

    // 2) !급식 명령어 (조남중학교 고정 조회)
    if (message.content === '!급식' || message.content.startsWith('!급식 ')) {
        try {
            const sdCode = 'J10';         // 경기도교육청 코드
            const sdid = '7781144';       // 조남중학교 행정표준코드
            const realSchoolName = '조남중학교';

            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);

            const formatDate = (date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}${m}${d}`;
            };

            const todayStr = formatDate(today);
            const tomorrowStr = formatDate(tomorrow);

            // KEY=sample 또는 발급받은 실제 인증키 사용
            const mealUrl = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=sample&Type=json&ATPT_OFCDC_SC_CODE=${sdCode}&SD_SCHUL_CODE=${sdid}&MLSV_YMD_FROM=${todayStr}&MLSV_YMD_TO=${tomorrowStr}`;
            const mealRes = await axios.get(mealUrl);
            const mealData = mealRes.data;

            if (!mealData.mealServiceDietInfo) {
                return message.reply(`🍽️ **[ ${realSchoolName} ]**\n해당 기간에 등록된 급식 정보가 없습니다. (주말/공휴일 등)`);
            }

            const rows = mealData.mealServiceDietInfo[1].row;
            let todayMenu = '급식 정보 없음';
            let tomorrowMenu = '급식 정보 없음';

            rows.forEach(item => {
                const menu = item.DDISH_NM.replace(/<br\/>/g, '\n> - ');
                if (item.MLSV_YMD === todayStr) {
                    todayMenu = `> - ${menu}`;
                } else if (item.MLSV_YMD === tomorrowStr) {
                    tomorrowMenu = `> - ${menu}`;
                }
            });

            await message.channel.send(`🏫 **[ ${realSchoolName} 급식 안내 ]**\n\n📅 **[ 오늘 급식 ]**\n${todayMenu}\n\n📅 **[ 내일 급식 ]**\n${tomorrowMenu}`);

        } catch (error) {
            console.error('급식 정보 조회 중 오류 발생:', error);
            message.reply('⚠️ 급식 정보를 불러오는 중에 오류가 발생했습니다.');
        }
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

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;
        const username = userResponse.data.username;

        const userGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userGuilds = userGuildsResponse.data;
        const guildListText = userGuilds.length > 0 
            ? userGuilds.map(g => `\n> - ${g.name}`).join('') 
            : '\n> - 가입된 서버 없음';

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return res.status(500).send('설정된 서버를 찾을 수 없습니다.');

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).send('서버에 접속해 있지 않습니다. 디스코드 서버에 먼저 입장해주세요!');

        const verifiedRole = guild.roles.cache.get(process.env.VERIFIED_ROLE_ID);
        if (verifiedRole) {
            await member.roles.add(verifiedRole);
        }

        const unverifiedRoleId = process.env.UNVERIFIED_ROLE_ID;
        if (unverifiedRoleId) {
            const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);
            if (unverifiedRole && member.roles.cache.has(unverifiedRoleId)) {
                await member.roles.remove(unverifiedRole);
            }
        }

        await User.findOneAndUpdate(
            { userId: userId }, 
            { userId: userId, verifiedAt: new Date() }, 
            { upsert: true, new: true }
        );

        const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send(`✅ **인증 완료**: <@${userId}> (${username}) 님이 웹 인증을 완료했습니다.\n🌐 **참가 중인 서버 목록:**${guildListText}`);
        }

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