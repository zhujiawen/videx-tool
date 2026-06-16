const app = getApp();

Page({
  data: {
    input: '',
    parsing: false,
    downloading: false,
    downloadProgress: 0,
    videoUrl: '',
    cover: '',
    title: '',
    author: '',
    duration: null,
    durationFormatted: '',
    likeCount: null,
    saveCount: null,
    commentCount: null,
    repostCount: null,
    likeCountText: '',
    saveCountText: '',
    commentCountText: '',
    repostCountText: '',
    width: null,
    height: null,
    awemeId: '',
    localPath: ''
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onClear() {
    this.setData({
      input: '',
      videoUrl: '',
      cover: '',
      title: '',
      author: '',
      duration: null,
      durationFormatted: '',
      likeCount: null,
      saveCount: null,
      commentCount: null,
      repostCount: null,
      likeCountText: '',
      saveCountText: '',
      commentCountText: '',
      repostCountText: '',
      width: null,
      height: null,
      awemeId: '',
      localPath: '',
      downloadProgress: 0
    });
  },

  async onPaste() {
    try {
      const res = await wx.getClipboardData();
      if (res && res.data) {
        this.setData({ input: res.data });
      }
    } catch (_) {}
  },

  onParse() {
    const text = (this.data.input || '').trim();
    if (!text) return;
    this.setData({
      parsing: true,
      videoUrl: '',
      localPath: '',
      downloadProgress: 0
    });

    wx.request({
      url: app.globalData.apiBase + '/api/parse',
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { text },
      success: (res) => {
        const body = res.data || {};
        if (body.code === 0 && body.data && body.data.videoUrl) {
          const d = body.data;
          this.setData({
            videoUrl: d.videoUrl,
            cover: d.cover || '',
            title: d.title || '抖音视频',
            author: d.author || '',
            duration: d.duration || null,
            durationFormatted: d.durationFormatted || '',
            likeCount: d.likeCount || null,
            saveCount: d.saveCount || null,
            commentCount: d.commentCount || null,
            repostCount: d.repostCount || null,
            likeCountText: this.fmtCount(d.likeCount),
            saveCountText: this.fmtCount(d.saveCount),
            commentCountText: this.fmtCount(d.commentCount),
            repostCountText: this.fmtCount(d.repostCount),
            width: d.width || null,
            height: d.height || null,
            awemeId: d.awemeId || ''
          });
          this.preDownload(d.videoUrl);
        } else {
          wx.showToast({ title: body.msg || '解析失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常，请检查后端服务', icon: 'none' });
      },
      complete: () => {
        this.setData({ parsing: false });
      }
    });
  },

  preDownload(videoUrl) {
    // Use server-side proxy so the mini program doesn't need douyin CDN in its whitelist
    const proxyUrl = app.globalData.apiBase + '/api/download?url=' + encodeURIComponent(videoUrl);
    this.setData({ downloading: true, downloadProgress: 0 });

    const task = wx.downloadFile({
      url: proxyUrl,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.showToast({ title: '视频下载失败', icon: 'none' });
          return;
        }
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (saved) => {
            this.setData({ localPath: saved.savedFilePath });
          },
          fail: () => {
            this.setData({ localPath: res.tempFilePath });
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '视频下载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ downloading: false });
      }
    });
    task.onProgressUpdate((p) => {
      this.setData({ downloadProgress: p.progress });
    });
  },

  onSave() {
    const filePath = this.data.localPath;
    if (!filePath) return;

    const save = () => {
      wx.showLoading({ title: '保存中', mask: true });
      wx.saveVideoToPhotosAlbum({
        filePath,
        success: () => {
          wx.hideLoading();
          wx.showToast({ title: '已保存到相册' });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      });
    };

    wx.getSetting({
      success: (s) => {
        if (s.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启「保存到相册」权限',
            confirmText: '去设置',
            success: (m) => {
              if (m.confirm) wx.openSetting({ success: () => {} });
            }
          });
        } else if (s.authSetting['scope.writePhotosAlbum'] === undefined) {
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: save,
            fail: () => wx.showToast({ title: '已取消授权', icon: 'none' })
          });
        } else {
          save();
        }
      }
    });
  },

  onShare() {
    const filePath = this.data.localPath;
    if (!filePath) return;

    const fileName = (this.data.title || 'douyin').slice(0, 40).replace(/[\\\/:*?"<>|\s]/g, '_') + '.mp4';

    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => {},
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        wx.showModal({
          title: '当前微信不支持直接分享',
          content: '已为你打开「保存到相册」流程，保存后请在微信选人发送视频。',
          showCancel: false,
          success: () => this.onSave()
        });
      }
    });
  },

  fmtCount(n) {
    if (n == null) return '';
    if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
});
