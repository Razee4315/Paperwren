"""Words for the fixes and features of the 2026-11 review: signing,
full screen, cropping, errors and more, in the same language order as
strings.py."""

ROWS = [
    # ---- fill & sign ----
    ("Place another", "ایک اور لگائیں", "ضع واحدًا آخر", "再放一个", "एक और लगाएँ", "Colocar otra", "En placer un autre", "Поставить ещё", "Colocar outra"),
    # ---- opening files ----
    ("File in use", "فائل استعمال میں ہے", "الملف قيد الاستخدام", "文件正在使用", "फ़ाइल उपयोग में है", "Archivo en uso", "Fichier en cours d'utilisation", "Файл занят", "Arquivo em uso"),
    ("{file} is open in another app that won't share it. Close it there, then try again.", "{file} کسی اور ایپ میں کھلی ہے جو اسے بانٹنے نہیں دیتی۔ اسے وہاں بند کریں، پھر دوبارہ کوشش کریں۔", "{file} مفتوح في تطبيق آخر لا يسمح بمشاركته. أغلقه هناك، ثم حاول مجددًا.", "{file} 已在另一个不允许共享的应用中打开。请在那里关闭它，然后重试。", "{file} किसी दूसरे ऐप में खुली है जो इसे साझा नहीं करता। उसे वहाँ बंद करें, फिर दोबारा कोशिश करें।", "{file} está abierto en otra aplicación que no lo comparte. Ciérralo allí y vuelve a intentarlo.", "{file} est ouvert dans une autre application qui ne le partage pas. Fermez-le là-bas, puis réessayez.", "{file} открыт в другом приложении, которое не даёт к нему доступа. Закройте его там и попробуйте снова.", "{file} está aberto em outro aplicativo que não o compartilha. Feche-o lá e tente novamente."),
    ("{file} could not be read.", "{file} نہیں پڑھی جا سکی۔", "تعذّرت قراءة {file}.", "无法读取 {file}。", "{file} पढ़ी नहीं जा सकी।", "No se pudo leer {file}.", "Impossible de lire {file}.", "Не удалось прочитать {file}.", "Não foi possível ler {file}."),
    ("Unavailable · click to locate", "دستیاب نہیں · تلاش کرنے کے لیے کلک کریں", "غير متاح · انقر لتحديد موقعه", "不可用 · 点击以查找", "उपलब्ध नहीं · ढूँढने के लिए क्लिक करें", "No disponible · haz clic para buscarlo", "Indisponible · cliquez pour le retrouver", "Недоступен · нажмите, чтобы найти", "Indisponível · clique para localizar"),
    # ---- cropping ----
    ("Nothing to crop on these pages", "ان صفحات پر کاٹنے کو کچھ نہیں", "لا شيء لقصّه في هذه الصفحات", "这些页面没有可裁剪的边距", "इन पन्नों पर काटने को कुछ नहीं", "No hay nada que recortar en estas páginas", "Rien à rogner sur ces pages", "На этих страницах нечего обрезать", "Nada para cortar nestas páginas"),
    ("Crop by hand", "خود کاٹیں", "القص يدويًا", "手动裁剪", "खुद काटें", "Recortar a mano", "Rogner à la main", "Обрезать вручную", "Cortar à mão"),
    ("Crop pages", "صفحات کاٹیں", "قص الصفحات", "裁剪页面", "पृष्ठ काटें", "Recortar páginas", "Rogner les pages", "Обрезка страниц", "Cortar páginas"),
    ("No crop", "کوئی کٹائی نہیں", "بلا قص", "不裁剪", "कोई कटाई नहीं", "Sin recorte", "Aucun rognage", "Без обрезки", "Sem corte"),
    ("Apply to", "کس پر لاگو کریں", "تطبيق على", "应用于", "किस पर लागू करें", "Aplicar a", "Appliquer à", "Применить к", "Aplicar a"),
    ("All pages", "تمام صفحات", "كل الصفحات", "所有页面", "सभी पृष्ठ", "Todas las páginas", "Toutes les pages", "Все страницы", "Todas as páginas"),
    ("Odd pages", "طاق صفحات", "الصفحات الفردية", "奇数页", "विषम पृष्ठ", "Páginas impares", "Pages impaires", "Нечётные страницы", "Páginas ímpares"),
    ("Even pages", "جفت صفحات", "الصفحات الزوجية", "偶数页", "सम पृष्ठ", "Páginas pares", "Pages paires", "Чётные страницы", "Páginas pares"),
    ("Leave out headers and page numbers", "ہیڈر اور صفحہ نمبر چھوڑ دیں", "استبعاد الترويسات وأرقام الصفحات", "略去页眉和页码", "हेडर और पृष्ठ संख्या छोड़ दें", "Omitir encabezados y números de página", "Ignorer les en-têtes et numéros de page", "Не учитывать колонтитулы и номера страниц", "Ignorar cabeçalhos e números de página"),
    ("What is kept of the page", "صفحے کا جو حصہ رکھا جائے گا", "ما يُبقى من الصفحة", "页面保留的部分", "पृष्ठ का जो हिस्सा रखा जाएगा", "Lo que se conserva de la página", "Ce qui est gardé de la page", "Что останется от страницы", "O que fica da página"),
    # ---- signing ----
    ("Photo", "تصویر", "صورة", "照片", "फ़ोटो", "Foto", "Photo", "Фото", "Foto"),
    # ---- side by side ----
    ("Side by side", "ساتھ ساتھ", "جنبًا إلى جنب", "并排", "साथ-साथ", "Lado a lado", "Côte à côte", "Рядом", "Lado a lado"),
    ("Show beside this", "اس کے ساتھ دکھائیں", "اعرض بجانب هذا", "在旁边显示", "इसके बगल में दिखाएँ", "Mostrar junto a este", "Afficher à côté", "Показать рядом", "Mostrar ao lado deste"),
    ("Swap sides", "اطراف بدلیں", "تبديل الجانبين", "交换左右", "दाएँ-बाएँ बदलें", "Intercambiar lados", "Inverser les côtés", "Поменять местами", "Trocar os lados"),
    ("Resize the two documents", "دونوں دستاویزات کا سائز بدلیں", "غيّر حجم المستندين", "调整两个文档的大小", "दोनों दस्तावेज़ों का आकार बदलें", "Cambiar el tamaño de los dos documentos", "Redimensionner les deux documents", "Изменить размер двух документов", "Redimensionar os dois documentos"),
]
