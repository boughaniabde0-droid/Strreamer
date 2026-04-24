const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تخزين حالة FFmpeg
let ffmpegProcess = null;

// التحقق من تثبيت FFmpeg
function checkFFmpeg() {
    return new Promise((resolve, reject) => {
        exec('ffmpeg -version', (error, stdout, stderr) => {
            if (error) {
                reject(new Error('FFmpeg غير مثبت على الخادم'));
            } else {
                resolve(stdout.split('\n')[0]);
            }
        });
    });
}

// نقطة نهاية للتحقق من الحالة
app.get('/api/status', async (req, res) => {
    try {
        const ffmpegVersion = await checkFFmpeg();
        res.json({
            success: true,
            ffmpeg: ffmpegVersion,
            streaming: ffmpegProcess !== null,
            uptime: process.uptime()
        });
    } catch (error) {
        res.json({
            success: true,
            ffmpeg: 'غير متوفر',
            streaming: ffmpegProcess !== null,
            uptime: process.uptime(),
            warning: error.message
        });
    }
});

// بدء البث
app.post('/api/start-stream', async (req, res) => {
    const { m3u8Url, streamKey } = req.body;
    
    if (!m3u8Url || !streamKey) {
        return res.status(400).json({ 
            success: false, 
            message: 'البيانات غير مكتملة - مطلوب رابط M3U8 ومفتاح البث' 
        });
    }

    if (ffmpegProcess) {
        return res.status(400).json({ 
            success: false, 
            message: 'البث يعمل بالفعل - أوقف البث الحالي أولاً' 
        });
    }

    try {
        // التحقق من FFmpeg
        await checkFFmpeg();
        
        const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        
        console.log(`بدء البث من ${m3u8Url} إلى فيسبوك`);
        
        // إعدادات FFmpeg المُحسَّنة لـ Render
        ffmpegProcess = spawn('ffmpeg', [
            '-re',                    // قراءة بسرعة حقيقية
            '-i', m3u8Url,           // ملف الإدخال
            '-c:v', 'libx264',       // ترميز الفيديو
            '-preset', 'ultrafast',   // أسرع إعداد (للتقليل من استهلاك CPU)
            '-tune', 'zerolatency',   // تقليل التأخير
            '-b:v', '1500k',         // معدل بت الفيديو (منخفض لتناسب موارد Render)
            '-maxrate', '1500k',
            '-bufsize', '3000k',
            '-pix_fmt', 'yuv420p',   // تنسيق البكسل
            '-g', '30',              // keyframe كل 30 إطار
            '-c:a', 'aac',           // ترميز الصوت
            '-b:a', '96k',           // معدل بت الصوت
            '-ar', '44100',          // تردد العينة
            '-ac', '2',              // قنوات صوت ستيريو
            '-f', 'flv',             // تنسيق الإخراج
            '-flvflags', 'no_duration_filesize',
            rtmpUrl                  // وجهة البث
        ]);

        // مراقبة مخرجات FFmpeg
        ffmpegProcess.stderr.on('data', (data) => {
            const message = data.toString();
            console.log(`FFmpeg: ${message}`);
            
            // كشف الأخطاء الشائعة
            if (message.includes('Connection refused') || 
                message.includes('Failed to resolve hostname')) {
                console.error('خطأ في الاتصال بفيسبوك');
            }
        });

        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`FFmpeg stdout: ${data}`);
        });

        // معالجة إغلاق العملية
        ffmpegProcess.on('close', (code) => {
            console.log(`FFmpeg توقف مع الرمز: ${code}`);
            ffmpegProcess = null;
        });

        ffmpegProcess.on('error', (err) => {
            console.error('فشل تشغيل FFmpeg:', err);
            ffmpegProcess = null;
        });

        // إرسال رد النجاح
        res.json({ 
            success: true, 
            message: 'تم بدء البث بنجاح إلى فيسبوك',
            pid: ffmpegProcess.pid
        });

    } catch (error) {
        console.error('خطأ في بدء البث:', error);
        res.status(500).json({ 
            success: false, 
            message: `فشل في بدء البث: ${error.message}` 
        });
    }
});

// إيقاف البث
app.post('/api/stop-stream', (req, res) => {
    if (ffmpegProcess) {
        console.log('جاري إيقاف البث...');
        
        // إرسال إشارة إنهاء لطيفة
        ffmpegProcess.stdin.write('q');
        
        // إجبار الإنهاء بعد 5 ثوانٍ إذا لم يستجب
        setTimeout(() => {
            if (ffmpegProcess) {
                ffmpegProcess.kill('SIGTERM');
                ffmpegProcess = null;
            }
        }, 5000);

        res.json({ 
            success: true, 
            message: 'تم إيقاف البث بنجاح' 
        });
    } else {
        res.json({ 
            success: false, 
            message: 'لا يوجد بث نشط للإيقاف' 
        });
    }
});

// تنظيف عند إيقاف الخادم
process.on('SIGTERM', () => {
    console.log('إيقاف الخادم...');
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
    process.exit(0);
});

// معالجة الأخطاء غير المتوقعة
process.on('uncaughtException', (error) => {
    console.error('خطأ غير متوقع:', error);
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
});

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`📡 API متاحة على: http://localhost:${PORT}/api/status`);
});
