import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEYS = {
  HOSPITAL_DATA: '@hospital_data',
  VISITS_DATA: '@visits_data',
  REQUESTS: '@requests',
  PROFILE: '@profile',
  WEEKDAY_LIMIT: '@weekday_limit',
  HOLIDAY_LIMIT: '@holiday_limit',
  SATURDAY_LIMIT: '@saturday_limit',
  SUNDAY_LIMIT: '@sunday_limit',
  PUBLIC_HOLIDAY_LIMIT: '@public_holiday_limit',
  MONTHLY_LIMITS: '@monthly_limits',
  MESSAGES: '@messages',
  SESSION_DURATION: '@session_duration',
  STAFF_VIEW_MODE: '@staff_view_mode',
  STAFF_LIST: '@staff_list',
  ADMIN_PASSWORD: '@admin_password',
};

export const saveData = async (key: string, value: any) => {
  try {
    const jsonValue = JSON.stringify(value);
    await AsyncStorage.setItem(key, jsonValue);
  } catch (e) {
    console.error('Error saving data:', e);
  }
};

export const loadData = async (key: string) => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    return jsonValue != null ? JSON.parse(jsonValue) : null;
  } catch (e) {
    console.error('Error loading data:', e);
    return null;
  }
};
