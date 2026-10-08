/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// types
import type { WeekMonthDataType, ChartDataType, TGanttViews } from "@plane/types";
import { EStartOfTheWeek } from "@plane/types";

// constants
export const generateWeeks = (startOfWeek: EStartOfTheWeek = EStartOfTheWeek.SUNDAY): WeekMonthDataType[] => [
  ...weeks.slice(startOfWeek),
  ...weeks.slice(0, startOfWeek),
];

export const weeks: WeekMonthDataType[] = [
  { key: 0, shortTitle: "sun", title: "周日", abbreviation: "周日" },
  { key: 1, shortTitle: "mon", title: "周一", abbreviation: "周一" },
  { key: 2, shortTitle: "tue", title: "周二", abbreviation: "周二" },
  { key: 3, shortTitle: "wed", title: "周三", abbreviation: "周三" },
  { key: 4, shortTitle: "thurs", title: "周四", abbreviation: "周四" },
  { key: 5, shortTitle: "fri", title: "周五", abbreviation: "周五" },
  { key: 6, shortTitle: "sat", title: "周六", abbreviation: "周六" },
];

export const months: WeekMonthDataType[] = [
  { key: 0, shortTitle: "jan", title: "1月", abbreviation: "1月" },
  { key: 1, shortTitle: "feb", title: "2月", abbreviation: "2月" },
  { key: 2, shortTitle: "mar", title: "3月", abbreviation: "3月" },
  { key: 3, shortTitle: "apr", title: "4月", abbreviation: "4月" },
  { key: 4, shortTitle: "may", title: "5月", abbreviation: "5月" },
  { key: 5, shortTitle: "jun", title: "6月", abbreviation: "6月" },
  { key: 6, shortTitle: "jul", title: "7月", abbreviation: "7月" },
  { key: 7, shortTitle: "aug", title: "8月", abbreviation: "8月" },
  { key: 8, shortTitle: "sept", title: "9月", abbreviation: "9月" },
  { key: 9, shortTitle: "oct", title: "10月", abbreviation: "10月" },
  { key: 10, shortTitle: "nov", title: "11月", abbreviation: "11月" },
  { key: 11, shortTitle: "dec", title: "12月", abbreviation: "12月" },
];

export const quarters: WeekMonthDataType[] = [
  { key: 0, shortTitle: "Q1", title: "Jan - Mar", abbreviation: "Q1" },
  { key: 1, shortTitle: "Q2", title: "Apr - Jun", abbreviation: "Q2" },
  { key: 2, shortTitle: "Q3", title: "Jul - Sept", abbreviation: "Q3" },
  { key: 3, shortTitle: "Q4", title: "Oct - Dec", abbreviation: "Q4" },
];

export const charCapitalize = (word: string) => `${word.charAt(0).toUpperCase()}${word.substring(1)}`;

export const bindZero = (value: number) => (value > 9 ? `${value}` : `0${value}`);

export const timePreview = (date: Date) => {
  let hours = date.getHours();
  const amPm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;

  let minutes: number | string = date.getMinutes();
  minutes = bindZero(minutes);

  return `${bindZero(hours)}:${minutes} ${amPm}`;
};

export const datePreview = (date: Date, includeTime: boolean = false) => {
  const day = date.getDate();
  let month: number | WeekMonthDataType = date.getMonth();
  month = months[month];
  const year = date.getFullYear();

  return `${charCapitalize(month?.shortTitle)} ${day}, ${year}${includeTime ? `, ${timePreview(date)}` : ``}`;
};

// context data
export const VIEWS_LIST: ChartDataType[] = [
  {
    key: "week",
    i18n_title: "common.week",
    data: {
      startDate: new Date(),
      currentDate: new Date(),
      endDate: new Date(),
      approxFilterRange: 4, // it will preview week dates with weekends highlighted with 1 week limitations ex: title (Wed 1, Thu 2, Fri 3)
      dayWidth: 60,
    },
  },
  {
    key: "month",
    i18n_title: "common.month",
    data: {
      startDate: new Date(),
      currentDate: new Date(),
      endDate: new Date(),
      approxFilterRange: 6, // it will preview monthly all dates with weekends highlighted with no limitations ex: title (1, 2, 3)
      dayWidth: 20,
    },
  },
  {
    key: "quarter",
    i18n_title: "common.quarter",
    data: {
      startDate: new Date(),
      currentDate: new Date(),
      endDate: new Date(),
      approxFilterRange: 24, // it will preview week starting dates all months data and there is 3 months limitation for preview ex: title (2, 9, 16, 23, 30)
      dayWidth: 5,
    },
  },
];

export const currentViewDataWithView = (view: TGanttViews = "month") =>
  VIEWS_LIST.find((_viewData) => _viewData.key === view);
