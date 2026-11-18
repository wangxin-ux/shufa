import type { ParentCourseCatalogItem, ParentCourseQuote } from '../types/parent';

export function presentCourseQuote(quote: ParentCourseQuote) {
  const yuan = Math.floor(quote.priceFen / 100);
  const fraction = quote.priceFen % 100;
  const priceLabel = `${yuan}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}¥`;
  return {
    ...quote,
    priceLabel,
    priceSize: Math.min(36, Math.floor(128 / (priceLabel.length * 0.69))),
    unitsLabel: `${quote.mainUnits / 100}节${quote.giftUnits ? ` + 赠${quote.giftUnits / 100}节` : ''}`,
  };
}

export function presentCourseCatalogItem(course: ParentCourseCatalogItem) {
  return {
    ...course,
    ...presentCourseQuote(course.primaryQuote),
    quotePanelHeight: Math.min(390, course.classTypes.reduce((height, type) => height + 44 + type.quotes.length * 64, 0)),
    classTypes: course.classTypes.map((type) => ({
      name: type.name, quotes: type.quotes.map(presentCourseQuote),
    })),
  };
}
