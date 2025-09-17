Amadeus Explorer 

required: nodejs, npm, jq

```sudo apt install nodejs npm jq```

To update the pflops_data.json you can add in the crontab (refreshtime you want) 

Exemple for 10 minutes:
```*/10 * * * * cd /var/www/html/amadeus && /usr/bin/node collect_pflops.js >> pflops_cron.log 2>&1```

