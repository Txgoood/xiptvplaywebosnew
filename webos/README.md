# XIPTV Play LG webOS TV (önizleme)

Android APK'dan bağımsızdır. GitHub Actions -> **Build LG webOS IPK** -> Run workflow -> Artifacts içinden IPK indirilir.

Bu ilk sürüm mevcut React arayüzünü kullanır; kumanda yön tuşlarıyla odak gezme ve OK seçimi eklenmiştir. TV cihazında medya kodekleri, playlist erişimi, giriş ekranları ve geri tuşu mutlaka test edilmelidir. Android indirme/yerel Capacitor servisleri webOS'de çalışmaz; bu sürüm için desteklenmez.

LG webOS TV'ye geliştirme amaçlı kurulum için TV'de Developer Mode, bilgisayarda webOS CLI ve `ares-setup-device` / `ares-install` gerekir. Developer Mode süresi sınırlı olabilir.
