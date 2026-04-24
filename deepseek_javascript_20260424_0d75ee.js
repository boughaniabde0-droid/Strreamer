// server.js - ضع هذا الملف في نفس المجلد
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

let ffmpegProcess = null;

// بدء البث
app.post('/api/start-stream', (req, res) => {
    const { m3u8Url, streamKey } = req.body;
    
    if (!m3u8Url || !streamKey) {
        return res.status(400).json({ success: false, message: 'البيانات غير مكتملة' });
    }

    if (ffmpegProcess) {
        return res.status(400).json({ success: false, message: 'البث يعمل بالفعل' });
    }

    try {
        const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        
        ffmpegProcess = spawn('ffmpeg', [
            '-re',
            '-i', m3u8Url,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-b:v', '2500k',
            '-maxrate', '2500k',
            '-bufsize', '5000k',
            '-pix_fmt', 'yuv420p',
            '-g', '60',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-f', 'flv',
            rtmpUrl
        ]);

        ffmpegProcess.stderr.on('data', (data) => {
            console.log(`FFmpeg: ${data}`);
        });

        ffmpegProcess.on('close', (code) => {
            console.log(`FFmpeg process exited with code ${code}`);
            ffmpegProcess = null;
        });

        ffmpegProcess.on('error', (err) => {
            console.error('Failed to start FFmpeg:', err);
            ffmpegProcess = null;
        });

        res.json({ success: true, message: 'تم بدء البث بنجاح' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// إيقاف البث
app.post('/api/stop-stream', (req, res) => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
        ffmpegProcess = null;
        res.json({ success: true, message: 'تم إيقاف البث' });
    } else {
        res.json({ success: false, message: 'لا يوجد بث نشط' });
    }
});

app.listen(3000, () => {
    console.log('الخادم يعمل على المنفذ 3000');
});