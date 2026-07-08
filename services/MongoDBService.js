import { mongoose } from "#lib";
import { config } from "#config";

/**
 * MongoDBService (singleton)
 * Owns the single mongoose connection for the whole app.
 */
class MongoDBService {
  static instance = null;

  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  static getInstance() {
    if (!MongoDBService.instance) {
      MongoDBService.instance = new MongoDBService();
    }
    return MongoDBService.instance;
  }

  async connect() {
    if (this.isConnected) {
      console.log("⚡ MongoDB already connected");
      return this.connection;
    }

    const uri =
      process.env.MONGODB_URI ||
      `mongodb://localhost:27017/${config.development.db.name}`;

    try {
      this.connection = await mongoose.connect(uri);
      this.isConnected = true;

      console.log("✅ MongoDB connected successfully");

      // Handle connection events
      mongoose.connection.on("error", (err) => {
        console.error("❌ MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        console.warn("⚠️ MongoDB disconnected");
        this.isConnected = false;
      });

      mongoose.connection.on("reconnected", () => {
        console.log("🔄 MongoDB reconnected");
        this.isConnected = true;
      });

      return this.connection;
    } catch (error) {
      console.error("❌ MongoDB connection error:", error);
      process.exit(1);
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.disconnect();
      this.isConnected = false;
      console.log("🔌 MongoDB disconnected");
    } catch (error) {
      console.error("❌ MongoDB disconnect error:", error);
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    };
  }
}

// Export singleton instance
const mongoDBService = MongoDBService.getInstance();

export { MongoDBService, mongoDBService };
