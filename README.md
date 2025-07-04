
## Hydra Dashboard


```Installation
Clone the repository or download: git clone https://github.com/RealAngry/HydraDashboard

go to panel directory: cd dash

Install some importent: apt install zip -y && unzip dashboard.zip && cd dash && apt install nano -y && nano .env

Install dependencies: npm install

Start the Panel: node . 
```
```env example
# PANEL settings
PANEL_URL=https://example.app
PANEL_KEY=0000000000000000

# Referral System
REFERRAL_BONUS=100
REFERRED_USER_BONUS=50
MAX_REFERRAL_CODES=5
BASE_URL=your_dash_link

# Linkvertise Settings
LINKVERTISE_ENABLED=false
LINKVERTISE_USER_ID=your_linkvertise_user_id
LINKVERTISE_API_KEY=your_linkvertise_api_key
LINKVERTISE_REWARD_AMOUNT=5
LINKVERTISE_DAILY_LIMIT=3

# Auth 
DISCORD_SERVER=https://discord.gg/example
DISCORD_CLIENT_ID=000000000000000000000
DISCORD_CLIENT_SECRET=0000000000000000000
DISCORD_CALLBACK_URL=https://urweb/callback/discord
PASSWORD_LENGTH=10

#proxycheck.io API key
PROXYCHECK_KEY=00000000000000000000000


# Webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_NOTIFICATIONS_ENABLED=true
EMBED_THUMBNAIL_URL=

# Session
SESSION_SECRET=default

# You Can Set it Any Key you want dont set the Panel API KEY | Must be 10 Letter long
API_KEY=000000000000000

# AFK
AFK_TIME=60                   

APP_NAME=Your Node
APP_LOGO=example.png/address of image
APP_URL=http://127.0.0.1:25002
APP_PORT=25002

# Admin
ADMIN_USERS=admin@gmail.com,admin2@gmail.co,

# Logs
LOGS_PATH=./storage/logs/services.log
LOGS_ERROR_PATH=./storage/logs/errors.log

# Basic plan 
DEFAULT_PLAN=BASIC

# Cost store ressources
CPU_COST=750
RAM_COST=500
DISK_COST=400
BACKUP_COST=250 # Not Set
DATABASE_COST=250 # Not Set
ALLOCATION_COST=500 # Not Set

# Developer
VERSION=3.0
