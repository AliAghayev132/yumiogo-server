import { bcrypt } from "#lib";

/**
 * HashService (static)
 * Password hashing/verification with bcrypt.
 */
class HashService {
  static saltRounds = 12;

  /**
   * Hash a plain password
   */
  static async hashPassword(password) {
    return bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Compare a plain password with a hash
   */
  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }
}

export { HashService };
